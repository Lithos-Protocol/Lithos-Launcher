import { randomBytes } from 'node:crypto'
import type { Network, NodeInfo } from '@shared/types'
import { detectErgo } from './ergo'
import { HELLO_HASH, HELLO_KEY, writeNodeConf } from './ergoConf'
import { detectJre } from './java'
import { heapPlan, javaEnv, layout, NODE_API_PORT } from './layout'
import { NodeApi } from './nodeApi'
import { ManagedProcess } from './process'
import { errorMessage, isPortListening, sleep } from './util'
import type { Vault } from './vault'

const API_STARTUP_TIMEOUT_MS = 5 * 60_000
const SHUTDOWN_TIMEOUT_MS = 2 * 60_000
const POLL_MS = 5000

/** Thrown inside a start flow that a later start/stop superseded. */
class Cancelled extends Error {}

export class NodeController {
  readonly proc = new ManagedProcess('node')
  private network: Network | null = null
  /** The API key the running node accepts. */
  private apiKey: string | null = null
  /** Bumped by start() and stop() so an in-flight start notices it was superseded. */
  private generation = 0
  private expectExit = false
  private pollToken = 0
  private lastInfo: NodeInfo | null = null

  constructor(
    private readonly root: string,
    private readonly vault: Vault,
    private readonly emitInfo: (info: NodeInfo | null) => void
  ) {
    this.proc.on('exit', (code: number | null) => this.onExit(code))
  }

  get runningNetwork(): Network | null {
    return this.proc.alive ? this.network : null
  }

  get info(): NodeInfo | null {
    return this.lastInfo
  }

  async start(network: Network): Promise<void> {
    const status = this.proc.state.status
    if (this.proc.alive || status === 'starting' || status === 'stopping') {
      throw new Error('The node is already running')
    }
    const gen = ++this.generation
    this.network = network
    this.proc.setState({ network, status: 'starting', detail: 'Checking install', exitCode: null })

    try {
      if (!(await detectJre(this.root))) throw new Error('Java is not installed yet')
      const ergo = await detectErgo(layout.nodeDir(this.root, network))
      if (!ergo) throw new Error('The Ergo node is not installed yet')
      const port = NODE_API_PORT[network]
      if (await isPortListening(port)) {
        throw new Error(`Port ${port} is already in use. Another Ergo node may be running.`)
      }
      this.check(gen)

      const stored = this.vault.getNodeKey(network)
      await writeNodeConf(this.root, network, stored?.hash ?? HELLO_HASH)
      this.apiKey = stored?.key ?? HELLO_KEY
      await this.launch(network, ergo.jar, gen)
      if (!stored) await this.rekey(network, ergo.jar, gen)

      this.proc.setState({ status: 'running', detail: null })
      this.proc.log('Node is running')
      this.startPolling(port)
    } catch (err) {
      if (err instanceof Cancelled || gen !== this.generation) {
        // stop() ran mid-start. If it found nothing to stop yet, clean up here.
        if (this.proc.alive && this.proc.state.status !== 'stopping') {
          this.proc.setState({ status: 'stopping', detail: 'Shutting down safely' })
          await this.shutdownProcess()
        }
        return
      }
      const message = errorMessage(err)
      this.proc.log(message)
      if (this.proc.alive) await this.shutdownProcess()
      const crashed = this.proc.state.status === 'crashed'
      this.proc.setState({ status: crashed ? 'crashed' : 'stopped', pid: null, detail: message })
      throw err
    }
  }

  async stop(): Promise<void> {
    this.generation++ // cancels an in-progress start
    this.stopPolling()
    if (!this.proc.alive) {
      if (this.proc.state.status !== 'crashed') this.proc.setState({ status: 'stopped', detail: null })
      return
    }
    this.proc.setState({ status: 'stopping', detail: 'Shutting down safely' })
    await this.shutdownProcess()
  }

  private check(gen: number): void {
    if (gen !== this.generation) throw new Cancelled()
  }

  private async launch(network: Network, jar: string, gen: number): Promise<void> {
    const { nodeMb } = heapPlan()
    this.proc.log(`Starting the Ergo node on ${network} (max heap ${nodeMb} MB)`)
    this.proc.spawn({
      command: layout.javaBin(this.root),
      args: [`-Xmx${nodeMb}m`, '-Dfile.encoding=UTF-8', '-jar', jar, `--${network}`, '-c', layout.ergoConf(this.root, network)],
      cwd: layout.nodeDir(this.root, network),
      env: javaEnv(this.root)
    })
    this.proc.setState({ detail: 'Waiting for the node API' })

    const api = new NodeApi(NODE_API_PORT[network])
    const deadline = Date.now() + API_STARTUP_TIMEOUT_MS
    for (;;) {
      this.check(gen)
      if (!this.proc.alive) throw new Error('The node exited during startup. See the Node log for details.')
      try {
        await api.info()
        return
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error('The node API did not respond within 5 minutes')
      await sleep(1000)
    }
  }

  /**
   * First start only: the node booted with the well-known "hello" key. Have it
   * hash a fresh random key, store that key, write its hash to ergo.conf and
   * restart once so the default key stops working.
   */
  private async rekey(network: Network, jar: string, gen: number): Promise<void> {
    this.proc.setState({ detail: 'Securing the API key (one-time restart)' })
    this.proc.log('First start: replacing the default API key with a private one. The node restarts once.')
    const api = new NodeApi(NODE_API_PORT[network])

    // Make sure the endpoint really computes blake2b256 before trusting it with the real key.
    if ((await api.blake2b(HELLO_KEY)) !== HELLO_HASH) throw new Error('The node hash check failed')
    const key = randomBytes(32).toString('base64url')
    const hash = await api.blake2b(key)
    await this.vault.setNodeKey(network, { key, hash })
    await writeNodeConf(this.root, network, hash)

    this.check(gen)
    await this.shutdownProcess()
    this.check(gen)
    this.apiKey = key
    await this.launch(network, jar, gen)
    if (!(await api.accepts(key))) throw new Error('The node did not accept its new API key')
  }

  /** Clean shutdown through the API; signals only as a fallback, a hard kill only after a timeout. */
  private async shutdownProcess(): Promise<void> {
    if (!this.proc.alive || !this.network) return
    this.expectExit = true
    let requested = false
    if (this.apiKey) {
      try {
        await new NodeApi(NODE_API_PORT[this.network]).shutdown(this.apiKey)
        requested = true
        this.proc.log('Asked the node to shut down')
      } catch (err) {
        this.proc.log(`Shutdown request failed: ${errorMessage(err)}`)
      }
    }
    if (!requested && process.platform !== 'win32') {
      this.proc.kill('SIGTERM') // the JVM still runs its shutdown hooks
      requested = true
    }
    if (requested && (await this.proc.waitForExit(SHUTDOWN_TIMEOUT_MS))) return
    this.proc.log('The node did not stop in time; forcing it to close')
    this.proc.kill('SIGKILL')
    await this.proc.waitForExit(10_000)
  }

  private onExit(code: number | null): void {
    this.stopPolling()
    if (this.expectExit) {
      this.expectExit = false
      this.proc.log(`Node stopped${code === null ? '' : ` (exit code ${code})`}`)
      if (this.proc.state.status === 'stopping') {
        this.proc.setState({ status: 'stopped', pid: null, exitCode: code, detail: null })
      } else {
        this.proc.setState({ pid: null, exitCode: code })
      }
      return
    }
    this.proc.log(`Node exited unexpectedly (exit code ${code ?? 'unknown'})`)
    this.proc.setState({
      status: 'crashed',
      pid: null,
      exitCode: code,
      detail: `The node exited unexpectedly (code ${code ?? 'unknown'})`
    })
  }

  private startPolling(port: number): void {
    const token = ++this.pollToken
    const api = new NodeApi(port)
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
    const tick = async (): Promise<void> => {
      try {
        const [info, indexedHeight] = await Promise.all([api.info(), api.indexedHeight()])
        if (token !== this.pollToken) return
        this.lastInfo = {
          appVersion: typeof info.appVersion === 'string' ? info.appVersion : null,
          fullHeight: num(info.fullHeight),
          headersHeight: num(info.headersHeight),
          maxPeerHeight: num(info.maxPeerHeight),
          peersCount: num(info.peersCount) ?? 0,
          indexedHeight
        }
        this.emitInfo(this.lastInfo)
      } catch {
        // node busy; try again next tick
      }
      if (token === this.pollToken) setTimeout(tick, POLL_MS)
    }
    void tick()
  }

  private stopPolling(): void {
    this.pollToken++
    if (this.lastInfo) {
      this.lastInfo = null
      this.emitInfo(null)
    }
  }
}
