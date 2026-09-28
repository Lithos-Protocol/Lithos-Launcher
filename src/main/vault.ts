import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { Network, VaultInfo } from '@shared/types'
import { writeFileAtomic } from './util'

export interface NodeKey {
  key: string
  /** blake2b256 of `key` as computed by the node. Not secret; lets ergo.conf be rewritten offline. */
  hash: string
}

interface VaultData {
  v: 1
  nodeKeys: Partial<Record<Network, NodeKey>>
}

/**
 * Secrets encrypted with the OS (DPAPI on Windows, libsecret/KWallet on Linux).
 * When only Electron's plaintext fallback is available, nothing is written to
 * disk: secrets live in memory for this session and are regenerated next time.
 */
export class Vault {
  readonly info: VaultInfo
  private data: VaultData = { v: 1, nodeKeys: {} }
  private readonly file = join(app.getPath('userData'), 'vault.bin')

  constructor() {
    const backend =
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'win32' ? 'dpapi' : 'keychain'
    const secure = safeStorage.isEncryptionAvailable() && backend !== 'basic_text' && backend !== 'unknown'
    this.info = { secure, backend }
  }

  async load(): Promise<void> {
    if (!this.info.secure) return
    let blob: Buffer
    try {
      blob = await readFile(this.file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    try {
      const parsed = JSON.parse(safeStorage.decryptString(blob)) as VaultData
      if (parsed.v === 1) this.data = parsed
    } catch {
      // Unreadable (e.g. OS profile changed). Start fresh; node keys are re-issued on next start.
      this.data = { v: 1, nodeKeys: {} }
    }
  }

  getNodeKey(network: Network): NodeKey | null {
    return this.data.nodeKeys[network] ?? null
  }

  async setNodeKey(network: Network, key: NodeKey): Promise<void> {
    this.data.nodeKeys[network] = key
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (!this.info.secure) return
    await writeFileAtomic(this.file, safeStorage.encryptString(JSON.stringify(this.data)), 0o600)
  }
}
