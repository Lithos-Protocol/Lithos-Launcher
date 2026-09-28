import type { Network, NetworkState, TaskId, TaskProgress } from '@shared/types'
import { detectErgo, installErgo } from './ergo'
import { HELLO_HASH, writeNodeConf } from './ergoConf'
import { detectJre, installJre } from './java'
import { layout, NODE_API_PORT } from './layout'
import { errorMessage } from './util'
import type { Vault } from './vault'

/** Installs whatever is missing for a network. State is read from disk, never cached. */
export class Installer {
  private busy = false

  constructor(
    private readonly root: string,
    private readonly vault: Vault,
    private readonly emit: (p: TaskProgress) => void
  ) {}

  async state(network: Network): Promise<NetworkState> {
    const [java, ergo] = await Promise.all([detectJre(this.root), detectErgo(layout.nodeDir(this.root, network))])
    return {
      network,
      folder: layout.netDir(this.root, network),
      java: { installed: java !== null, version: java },
      node: { installed: ergo !== null, version: ergo?.version ?? null, apiPort: NODE_API_PORT[network] }
    }
  }

  async install(network: Network): Promise<NetworkState> {
    if (this.busy) throw new Error('An install is already in progress')
    this.busy = true
    try {
      if (!(await detectJre(this.root))) {
        await this.run('java', () => installJre(this.root, this.emit))
      }
      const nodeDir = layout.nodeDir(this.root, network)
      if (!(await detectErgo(nodeDir))) {
        await this.run('node', () => installErgo(nodeDir, this.emit))
      }
      await writeNodeConf(this.root, network, this.vault.getNodeKey(network)?.hash ?? HELLO_HASH)
      return await this.state(network)
    } finally {
      this.busy = false
    }
  }

  private async run(task: TaskId, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.emit({ task, phase: 'error', message: errorMessage(err) })
      throw err
    }
  }
}
