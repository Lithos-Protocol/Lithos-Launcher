import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { WINDOW_BLOCKS } from '@shared/mining'
import { syncView } from '@shared/sync'
import type { ClientStats, CommitmentRead, CommitmentReads, CommitmentSent, Network, WalletState } from '@shared/types'
import { clientRetired } from '@shared/versions'
import { CLIENT_ENV, managedClientKeys, readClientSettings, TEST_MODE_LINES, writeClientConf } from './clientConf'
import { commitError, commitmentOf, legacyCommitmentOf, sentOf } from './commitment'
import { diagnose } from './diagnose'
import { singleFlight } from './singleFlight'
import { interrupt } from './interrupt'
import { detectJre } from './java'
import { heapPlan, javaEnv, layout } from './layout'
import { detectClient, findKeystore } from './lithosClient'
import { customOverrides } from './managedBlock'
import type { NodeController } from './nodeController'
import { ManagedProcess } from './process'
import { pinnedVersion } from './settings'
import { lanAddresses } from './system'
import { errorMessage, isPortListening, sleep } from './util'
import type { Vault } from './vault'
import type { WalletManager } from './wallet'

const HTTP_WAIT_MS = 3 * 60_000
const SHUTDOWN_TIMEOUT_MS = 60_000
const STATS_POLL_MS = 10_000

/** Thrown inside a start flow that a later start/stop superseded. */
class Cancelled extends Error {}

/** The client waits up to a minute for its transaction engine to send a commitment. */
const COMMIT_TIMEOUT_MS = 90_000
const COMMIT_READ_TIMEOUT_MS = 30_000
/**
 * How often a commitment that is still settling is read again, between blocks. Right after the
 * client starts, its sync reports "not ready" until it commits a block, which a once-per-block read
 * would show for a whole block or more.
 */
const COMMIT_SETTLING_MS = 30_000

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : null
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)

/** Runs the Lithos Client against the launcher's node and wallet. */
export class ClientController {
  readonly proc = new ManagedProcess('client')
  private network: Network | null = null
  /** Bumped by start() and stop() so an in-flight start notices it was superseded. */
  private generation = 0
  private expectExit = false
  private statsToken = 0
  private lastStats: ClientStats | null = null
  /** The last commitment read per network, kept for the session after the client stops. */
  private reads: CommitmentReads = {}
  /** The wallet address each read belongs to, so another wallet on that network drops it. */
  private readers: Partial<Record<Network, string | null>> = {}
  /** Whether the running client has `/mining/commitment`; null until it has been asked. */
  private commitApi: boolean | null = null
  /** The node height the commitment was last read at, so it is read again once per block. */
  private commitReadHeight: number | null | undefined = undefined
  private commitReadAt = 0
  /** Reads `GET /mining/commitment` from the running client; concurrent calls share one read. */
  private readonly readCommitment = singleFlight(() => this.fetchCommitment())

  constructor(
    private readonly root: string,
    private readonly vault: Vault,
    private readonly node: NodeController,
    private readonly wallet: WalletManager,
    /** Development only: allow starting before the node is synced. */
    private readonly skipSyncGate: boolean,
    private readonly emitStats: (stats: ClientStats | null) => void,
    private readonly emitCommitments: (reads: CommitmentReads) => void
  ) {
    this.proc.on('exit', (code: number | null) => this.onExit(code))
    this.wallet.on('state', (w: WalletState) => this.onWallet(w))
  }

  get stats(): ClientStats | null {
    return this.lastStats
  }

  get commitments(): CommitmentReads {
    return this.reads
  }

  get runningNetwork(): Network | null {
    return this.proc.alive ? this.network : null
  }

  get httpPort(): number | null {
    return this.proc.alive ? (this.proc.state.ports?.http ?? null) : null
  }

  async start(network: Network): Promise<void> {
    const status = this.proc.state.status
    if (this.proc.alive || status === 'starting' || status === 'stopping') {
      throw new Error('The Lithos Client is already running')
    }
    const gen = ++this.generation
    this.network = network
    this.proc.setState({ network, status: 'starting', detail: 'Checking requirements', exitCode: null, ports: null })

    try {
      if (!(await detectJre(this.root))) throw new Error('Java is not installed yet')
      const client = await detectClient(layout.clientDir(this.root, network), pinnedVersion(network, 'client'))
      if (!client) throw new Error('The Lithos Client is not installed yet')
      const retired = clientRetired(client.version)
      if (retired) throw new Error(`Lithos Client ${client.version} is retired: ${retired}. Switch it under Versions.`)
      const conn = this.node.connection()
      if (!conn || conn.network !== network) throw new Error(`Start the ${network} node first`)
      const info = this.node.info
      if (!this.skipSyncGate && (!info || syncView(info).stage !== 'synced')) {
        throw new Error('Wait until the node is fully synced and indexed')
      }
      // Verified against the node itself (not cached state) right before launch.
      await this.wallet.unlockForClient(network)
      const password = this.vault.getWalletPassword(network)
      if (!password) throw new Error('Unlock the wallet first')
      const keystore = await findKeystore(layout.keystoreDir(this.root, network))
      if (!keystore) throw new Error('No wallet keystore was found for this node')

      const settings = await readClientSettings(this.root, network)
      if (!settings.diff) throw new Error('Choose your mining difficulty first')
      const ports = { http: settings.httpPort, stratum: settings.stratumPort }
      if (await isPortListening(ports.http)) {
        throw new Error(`Port ${ports.http} (Lithos panel) is already in use. Is another Lithos Client running?`)
      }
      if (await isPortListening(ports.stratum)) {
        throw new Error(`Port ${ports.stratum} (stratum) is already in use. Is another Lithos Client running?`)
      }

      // The client's own API key is hashed by the node, like the node's key. Play's secret is random.
      let lithosKey = this.vault.getLithosKey(network)
      if (!lithosKey) {
        const key = randomBytes(32).toString('base64url')
        lithosKey = { key, hash: await conn.api.blake2b(key) }
        await this.vault.setLithosKey(network, lithosKey)
      }
      let playSecret = this.vault.getPlaySecret(network)
      if (!playSecret) {
        playSecret = randomBytes(48).toString('base64url')
        await this.vault.setPlaySecret(network, playSecret)
      }

      const lan = lanAddresses()
      await writeClientConf(this.root, {
        network,
        appHome: client.home,
        keystore,
        lithosApiKeyHash: lithosKey.hash,
        settings,
        nodeApiPort: conn.api.port,
        lanHosts: [...lan, hostname()]
      })
      const overrides = await customOverrides(layout.clientConf(this.root, network), managedClientKeys(settings)).catch(
        () => []
      )
      // Test mode promises nothing reaches the chain; a hand edit below the block would decide that instead.
      const contested = settings.forceConfigDiff ? overrides.filter((key) => key in TEST_MODE_LINES) : []
      if (contested.length) {
        throw new Error(
          `Test mining keeps transactions off, but lithos.conf sets ${contested.join(', ')} below the launcher's ` +
            'block, where it wins. Remove those lines, or use Start client for real mining.'
        )
      }
      if (overrides.length) {
        this.proc.log(
          `Warning: lithos.conf overrides settings the launcher manages (${overrides.join(', ')}). ` +
            'The client may not work as expected, and Settings may not show what it actually uses.'
        )
      }
      this.check(gen)

      const { clientMb } = heapPlan()
      this.proc.setRedactions([conn.apiKey, password, playSecret, lithosKey.key])
      this.proc.log(`Starting Lithos Client ${client.version} on ${network} (max heap ${clientMb} MB)`)
      this.proc.spawn({
        command: layout.javaBin(this.root),
        args: [
          `-Xmx${clientMb}m`,
          '-Dfile.encoding=UTF-8',
          `-Dconfig.file=${layout.clientConf(this.root, network)}`,
          // The launcher tracks the process itself, so no RUNNING_PID file to go stale after a crash.
          '-Dplay.server.pidfile.path=/dev/null',
          '-jar',
          client.launcherJar
        ],
        cwd: layout.clientDir(this.root, network),
        // Secrets reach the client only through its environment, never through a file.
        env: {
          ...javaEnv(this.root),
          [CLIENT_ENV.nodeKey]: conn.apiKey,
          [CLIENT_ENV.nodePass]: password,
          [CLIENT_ENV.playSecret]: playSecret
        }
      })
      this.proc.setState({ detail: 'Waiting for the Lithos Client to come up', ports: { ...ports } })

      const up = await this.waitForHttp(ports.http, gen)
      this.proc.setState({ status: 'running', detail: up ? null : 'Started, but the panel is not answering yet' })
      this.proc.log(`Lithos Client is running. Panel: http://127.0.0.1:${ports.http}  Stratum port: ${ports.stratum}`)
      if (settings.lanPanel && lan.length) {
        this.proc.log(`The panel is open to your network: ${lan.map((a) => `http://${a}:${ports.http}`).join('  ')}`)
      }
      this.proc.log(
        settings.forceConfigDiff
          ? `Test mining at ${settings.diff}: transforms, emissions, broadcasts and block transactions are off, so no transactions are sent`
          : settings.autoCommit
            ? `Difficulty ${settings.diff}, auto-commit on`
            : `Difficulty ${settings.diff}, auto-commit off: commitments are sent from the launcher's Commit dialog`
      )
      this.commitApi = null
      this.startStats(ports.http, network)
    } catch (err) {
      if (err instanceof Cancelled || gen !== this.generation) {
        if (this.proc.alive && this.proc.state.status !== 'stopping') {
          this.proc.setState({ status: 'stopping', detail: 'Shutting down safely' })
          await this.shutdownProcess()
        }
        return
      }
      let message = errorMessage(err)
      if (message.startsWith('The Lithos Client exited during startup')) {
        message = diagnose('client', this.proc.snapshot().lines) ?? message
      }
      this.proc.log(message)
      if (this.proc.alive) await this.shutdownProcess()
      const crashed = this.proc.state.status === 'crashed'
      this.proc.setState({ status: crashed ? 'crashed' : 'stopped', pid: null, ports: null, detail: message })
      throw err
    }
  }

  /**
   * Replaces the Lithos API key with `chosen`, or a fresh random one, hashed by the node. A running
   * client restarts to use it.
   */
  async replaceKey(network: Network, chosen: string | null): Promise<void> {
    const conn = this.node.connection()
    if (!conn || conn.network !== network) throw new Error(`Start the ${network} node first`)
    const key = chosen ?? randomBytes(32).toString('base64url')
    await this.vault.setLithosKey(network, { key, hash: await conn.api.blake2b(key) })
    this.proc.log('Replaced the Lithos API key')
    if (this.runningNetwork === network) await this.restart(network)
  }

  /** Stops and starts again so changed settings take effect. */
  async restart(network: Network): Promise<void> {
    await this.stop()
    await this.start(network)
  }

  async stop(): Promise<void> {
    this.generation++ // cancels an in-progress start
    this.stopStats()
    if (!this.proc.alive) {
      if (this.proc.state.status !== 'crashed') this.proc.setState({ status: 'stopped', detail: null, ports: null })
      return
    }
    this.proc.setState({ status: 'stopping', detail: 'Shutting down safely' })
    await this.shutdownProcess()
  }

  private check(gen: number): void {
    if (gen !== this.generation) throw new Cancelled()
  }

  /**
   * True once the Play server answers (any status). False if it hasn't within the
   * wait; the client is left running, since a slow first start isn't a failure.
   */
  private async waitForHttp(port: number, gen: number): Promise<boolean> {
    const deadline = Date.now() + HTTP_WAIT_MS
    while (Date.now() < deadline) {
      this.check(gen)
      if (!this.proc.alive) throw new Error('The Lithos Client exited during startup. See the Client log for details.')
      try {
        await fetch(`http://127.0.0.1:${port}/info`, { signal: AbortSignal.timeout(2000) })
        return true
      } catch {
        // not listening yet
      }
      await sleep(1000)
    }
    return false
  }

  /** Ctrl+C (Windows) or SIGTERM (Linux) so the JVM runs its shutdown hooks; hard kill only after a timeout. */
  private async shutdownProcess(): Promise<void> {
    const pid = this.proc.state.pid
    if (!this.proc.alive || pid === null) return
    this.expectExit = true
    const sent = await interrupt(pid)
    if (sent) {
      this.proc.log(process.platform === 'win32' ? 'Sent Ctrl+C to the Lithos Client' : 'Sent SIGTERM to the Lithos Client')
      if (await this.proc.waitForExit(SHUTDOWN_TIMEOUT_MS)) return
    }
    this.proc.log('The Lithos Client did not stop in time; forcing it to close')
    this.proc.kill('SIGKILL')
    await this.proc.waitForExit(10_000)
  }

  /** Polls the client's open stats endpoints (no API key needed) while it runs. */
  private startStats(port: number, network: Network): void {
    const token = ++this.statsToken
    const get = async (path: string): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) })
        return res.ok ? ((await res.json()) as Record<string, unknown>) : null
      } catch {
        return null
      }
    }
    const tick = async (): Promise<void> => {
      const [overview, workers] = await Promise.all([get('/stats'), get('/stats/mining/workers')])
      if (token !== this.statsToken) return
      const stratum = ((overview?.local as Record<string, unknown> | undefined)?.stratum ?? {}) as Record<string, unknown>
      const diff = stratum.difficulty as Record<string, unknown> | undefined
      if (overview || workers) {
        this.lastStats = {
          stratumStatus: str(stratum.status),
          rigs: num(stratum.connectedConnections) ?? 0,
          hashesPerSecond: num(workers?.hashesPerSecond),
          superShares: num(workers?.superShares) ?? 0,
          superSharesPerHour: num(workers?.superSharesPerHour),
          forcedConfig: diff?.forcedConfig === true
        }
        this.emitStats(this.lastStats)
      }
      if (this.commitApi === false) {
        // An older client: its stats carry the commitment for free.
        const read = diff ? legacyCommitmentOf(diff, WINDOW_BLOCKS) : null
        if (read) this.remember(network, read)
      } else if (this.commitReadDue(network)) {
        void this.readCommitment()
      }
      if (token === this.statsToken) setTimeout(tick, STATS_POLL_MS)
    }
    this.commitReadHeight = undefined
    void tick()
  }

  /**
   * Each read costs the client node calls, and a settled commitment only moves with the chain, so
   * it is read once per block. One still settling (the client syncing, a send confirming) is read
   * every COMMIT_SETTLING_MS too.
   */
  private commitReadDue(network: Network): boolean {
    if ((this.node.info?.fullHeight ?? null) !== this.commitReadHeight) return true
    const read = this.reads[network]
    const settling =
      !read ||
      read.state === 'unknown' ||
      read.state === 'registering' ||
      read.blockedReason === 'SYNCING' ||
      read.blockedReason === 'UNAVAILABLE' ||
      read.blockedReason === 'IN_FLIGHT'
    return settling && Date.now() - this.commitReadAt >= COMMIT_SETTLING_MS
  }

  private async fetchCommitment(): Promise<void> {
    const network = this.runningNetwork
    const port = this.httpPort
    if (network === null || port === null) return
    this.commitReadHeight = this.node.info?.fullHeight ?? null
    this.commitReadAt = Date.now()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mining/commitment`, {
        signal: AbortSignal.timeout(COMMIT_READ_TIMEOUT_MS)
      })
      if (res.status === 404) {
        this.commitApi = false
        return
      }
      // Anything else that isn't a status (the client still starting, say) keeps the last read.
      const read = res.ok ? commitmentOf(await res.json()) : null
      if (!read) return
      this.commitApi = true
      // A chain the client couldn't read says nothing about the commitment read before.
      if (read.blockedReason === 'UNAVAILABLE' && this.reads[network]) return
      this.remember(network, read)
    } catch {
      // Not answering yet: no node calls were made, so the next stats poll tries again.
      this.commitReadHeight = undefined
    }
  }

  /** Reads the running client's commitment again, now. */
  async refreshCommitment(network: Network): Promise<void> {
    if (this.commitApi === false || this.runningNetwork !== network) return
    await this.readCommitment.fresh()
  }

  /** Registers this miner with `diff`, or changes its commitment to it, through the running client. */
  async commit(network: Network, diff: string): Promise<CommitmentSent> {
    const port = this.runningNetwork === network && this.proc.state.status === 'running' ? this.httpPort : null
    if (port === null) throw new Error(`Start the ${network} Lithos Client first`)
    if (this.commitApi === false) {
      throw new Error('This Lithos Client version has no commitment API. Update it under Versions to commit from here.')
    }
    const key = this.vault.getLithosKey(network)
    if (!key) throw new Error('The Lithos API key is missing. Restart the client to make one.')
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${port}/mining/commitment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', api_key: key.key },
        body: JSON.stringify({ diff }),
        signal: AbortSignal.timeout(COMMIT_TIMEOUT_MS)
      })
    } catch {
      await this.refreshCommitment(network)
      throw new Error("The Lithos Client didn't answer in time and may still send it. Check your commitment again before retrying.")
    }
    const body: unknown = await res.json().catch(() => null)
    // Sent or not, what the chain holds may have moved.
    await this.refreshCommitment(network)
    if (!res.ok) {
      const message = commitError(res.status, body)
      this.proc.log(`Commitment of ${diff} not sent: ${message}`)
      throw new Error(message)
    }
    const sent = sentOf(body, diff)
    this.proc.log(
      `Sent ${sent.kind === 'registration' ? 'registration with commitment' : 'commitment'} ${sent.diff} as ` +
        `${sent.txId} (${sent.outcome}). In force from block ${sent.inForceFromHeight}.`
    )
    return sent
  }

  private remember(network: Network, read: CommitmentRead): void {
    const w = this.wallet.state
    this.readers[network] = (w.network === network ? w.address : null) ?? this.readers[network] ?? null
    const before = this.reads[network]
    if (JSON.stringify(before) === JSON.stringify(read)) return
    if (read.api && (before?.state !== read.state || before?.blockedReason !== read.blockedReason)) {
      const blocked = read.blockedReason ? `, can't commit yet (${read.blockedReason.toLowerCase().replace('_', ' ')})` : ''
      this.proc.log(`Commitment status: ${read.state}${blocked}${read.reason ? `: ${read.reason}` : ''}`)
    }
    this.reads = { ...this.reads, [network]: read }
    this.emitCommitments(this.reads)
  }

  /** A different wallet on a network makes what was read there someone else's commitment. */
  private onWallet(w: WalletState): void {
    const network = w.network
    if (!network || !w.address || !this.reads[network]) return
    const reader = this.readers[network]
    if (reader === null || reader === undefined || reader === w.address) return
    const next = { ...this.reads }
    delete next[network]
    delete this.readers[network]
    this.reads = next
    this.emitCommitments(this.reads)
  }

  private stopStats(): void {
    this.statsToken++
    if (this.lastStats) {
      this.lastStats = null
      this.emitStats(null)
    }
  }

  private onExit(code: number | null): void {
    this.stopStats()
    if (this.expectExit) {
      this.expectExit = false
      this.proc.log(`Lithos Client stopped${code === null ? '' : ` (exit code ${code})`}`)
      if (this.proc.state.status === 'stopping') {
        this.proc.setState({ status: 'stopped', pid: null, exitCode: code, detail: null, ports: null })
      } else {
        this.proc.setState({ pid: null, exitCode: code, ports: null })
      }
      return
    }
    this.proc.log(`Lithos Client exited unexpectedly (exit code ${code ?? 'unknown'})`)
    this.proc.setState({
      status: 'crashed',
      pid: null,
      exitCode: code,
      ports: null,
      detail:
        diagnose('client', this.proc.snapshot().lines) ??
        `The Lithos Client exited unexpectedly (code ${code ?? 'unknown'}). See the Client log.`
    })
  }
}
