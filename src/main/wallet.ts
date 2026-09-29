import { EventEmitter } from 'node:events'
import {
  MIN_PASSWORD_LENGTH,
  MNEMONIC_LENGTHS,
  type Network,
  type ProcState,
  type WalletState
} from '@shared/types'
import type { NodeConnection, NodeController } from './nodeController'
import { errorMessage } from './util'
import type { Vault } from './vault'

const POLL_MS = 10_000

const UNAVAILABLE: WalletState = {
  network: null,
  phase: 'unavailable',
  address: null,
  passwordKnown: false,
  balanceNanoErg: null,
  error: null
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters`)
  }
}

/** Lowercases, collapses whitespace and checks the word count. The node validates the checksum. */
function normalizeMnemonic(mnemonic: string): string {
  const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!(MNEMONIC_LENGTHS as readonly number[]).includes(words.length)) {
    throw new Error(`A seed phrase has ${MNEMONIC_LENGTHS.join(', ')} words. This one has ${words.length}.`)
  }
  return words.join(' ')
}

/**
 * The node wallet the Lithos Client signs with. Unlocks it automatically on
 * every node start when the password is known. Emits 'state' (WalletState).
 */
export class WalletManager extends EventEmitter {
  private current: WalletState = UNAVAILABLE
  private pollToken = 0
  private unlocking = false
  /** One automatic re-unlock per lock; reset once the wallet is unlocked again. */
  private relockTried = false

  constructor(
    private readonly node: NodeController,
    private readonly vault: Vault
  ) {
    super()
    node.on('ready', (network: Network) => void this.onNodeReady(network))
    node.proc.on('state', (s: ProcState) => {
      if (s.status !== 'running' && this.current.phase !== 'unavailable') {
        this.pollToken++
        this.set(UNAVAILABLE)
      }
    })
  }

  get state(): WalletState {
    return this.current
  }

  async create(password: string): Promise<string[]> {
    checkPassword(password)
    const conn = this.connection()
    if ((await conn.api.walletStatus(conn.apiKey)).isInitialized) throw new Error('This node already has a wallet')
    const mnemonic = await conn.api.walletInit(conn.apiKey, password)
    await this.vault.setWalletPassword(conn.network, password, true)
    this.node.proc.log('Wallet created')
    await this.ensureUnlocked(conn, password)
    return mnemonic.trim().split(/\s+/)
  }

  async restore(mnemonic: string, password: string): Promise<void> {
    checkPassword(password)
    const phrase = normalizeMnemonic(mnemonic)
    const conn = this.connection()
    if ((await conn.api.walletStatus(conn.apiKey)).isInitialized) throw new Error('This node already has a wallet')
    await conn.api.walletRestore(conn.apiKey, phrase, password)
    await this.vault.setWalletPassword(conn.network, password, true)
    this.node.proc.log('Wallet restored from seed phrase')
    await this.ensureUnlocked(conn, password)
  }

  async unlock(password: string, remember: boolean): Promise<void> {
    const conn = this.connection()
    await this.tryUnlock(conn, password)
    if (this.current.phase !== 'unlocked') throw new Error(this.current.error ?? 'The wallet did not unlock')
    await this.vault.setWalletPassword(conn.network, password, remember)
    await this.refresh()
  }

  /**
   * Checks the node wallet through the API right now and unlocks it if needed. The Lithos
   * Client relies on an unlocked node wallet: emission joins derive new keys through it, and
   * the node's candidate generation may not start without it.
   */
  async unlockForClient(network: Network): Promise<void> {
    const conn = this.connection()
    if (conn.network !== network) throw new Error(`Start the ${network} node first`)
    const status = await conn.api.walletStatus(conn.apiKey)
    if (!status.isInitialized) throw new Error('Create or restore the wallet first')
    if (status.isUnlocked) return
    const password = this.vault.getWalletPassword(network)
    if (!password) throw new Error('Unlock the wallet first')
    await this.tryUnlock(conn, password)
    if (this.current.phase !== 'unlocked') throw new Error(this.current.error ?? 'The wallet did not unlock')
  }

  private connection(): NodeConnection {
    const conn = this.node.connection()
    if (!conn) throw new Error('Start the node first')
    return conn
  }

  private async onNodeReady(network: Network): Promise<void> {
    const conn = this.node.connection()
    const saved = this.vault.getWalletPassword(network)
    // This start-up unlock counts as the one automatic attempt for this lock.
    this.relockTried = saved !== null
    // With a known password, go straight to unlocking so the UI never flashes a password form.
    if (conn && saved) {
      try {
        const s = await conn.api.walletStatus(conn.apiKey)
        if (s.isInitialized && !s.isUnlocked) {
          await this.tryUnlock(conn, saved)
          if (this.current.phase === 'locked') {
            this.set({ ...this.current, error: 'The saved password did not unlock the wallet. Enter it again.' })
          }
        }
      } catch {
        // fall through to a normal refresh
      }
    }
    await this.refresh()
    this.startPolling()
  }

  /** Newly created/restored wallets may already be unlocked; unlock only if needed. */
  private async ensureUnlocked(conn: NodeConnection, password: string): Promise<void> {
    await this.refresh()
    if (this.current.phase === 'locked') await this.tryUnlock(conn, password)
  }

  private async tryUnlock(conn: NodeConnection, password: string): Promise<void> {
    this.unlocking = true
    this.set({ ...this.current, phase: 'unlocking', error: null })
    try {
      await conn.api.walletUnlock(conn.apiKey, password)
      this.node.proc.log('Wallet unlocked')
    } catch (err) {
      this.node.proc.log(`Wallet unlock failed: ${errorMessage(err)}`)
      this.set({ ...this.current, phase: 'locked', error: 'That password did not unlock the wallet.' })
      return
    } finally {
      this.unlocking = false
    }
    await this.refresh()
  }

  private async refresh(): Promise<void> {
    if (this.unlocking) return
    const conn = this.node.connection()
    if (!conn) {
      this.set(UNAVAILABLE)
      return
    }
    try {
      const s = await conn.api.walletStatus(conn.apiKey)
      if (this.unlocking) return
      const phase = !s.isInitialized ? 'uninitialized' : s.isUnlocked ? 'unlocked' : 'locked'
      let balanceNanoErg: number | null = null
      if (s.isUnlocked) {
        try {
          balanceNanoErg = await conn.api.walletBalance(conn.apiKey)
        } catch {
          balanceNanoErg = this.current.balanceNanoErg // keep the last reading on a hiccup
        }
      }
      if (this.unlocking) return
      this.set({
        network: conn.network,
        phase,
        address: s.isUnlocked && s.changeAddress ? s.changeAddress : null,
        passwordKnown: this.vault.getWalletPassword(conn.network) !== null,
        balanceNanoErg,
        error: phase === 'locked' ? this.current.error : null
      })
      await this.relockGuard(conn, phase)
    } catch {
      // node busy; keep the last known state
    }
  }

  /**
   * The Lithos Client needs the node wallet unlocked the whole time it runs. If it becomes
   * locked (e.g. through the node panel), unlock it again once with the known password; a
   * failed attempt waits for the user instead of retrying every poll.
   */
  private async relockGuard(conn: NodeConnection, phase: WalletState['phase']): Promise<void> {
    if (phase === 'unlocked') {
      this.relockTried = false
      return
    }
    const password = this.vault.getWalletPassword(conn.network)
    if (phase !== 'locked' || !password || this.relockTried) return
    this.relockTried = true
    this.node.proc.log('The node wallet was locked; unlocking it again')
    await this.tryUnlock(conn, password)
  }

  private startPolling(): void {
    const token = ++this.pollToken
    const tick = async (): Promise<void> => {
      if (token !== this.pollToken) return
      await this.refresh()
      if (token === this.pollToken) setTimeout(tick, POLL_MS)
    }
    setTimeout(tick, POLL_MS)
  }

  private set(next: WalletState): void {
    const prev = this.current
    this.current = next
    if (JSON.stringify(prev) !== JSON.stringify(next)) this.emit('state', next)
  }
}
