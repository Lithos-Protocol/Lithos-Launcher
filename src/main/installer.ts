import {
  ERGO_DB_LABEL,
  ergoDb,
  type JavaList,
  type Network,
  type NetworkState,
  type ProcId,
  type ReleaseList,
  type TaskId,
  type TaskProgress
} from '@shared/types'
import { clientRetired, DEFAULT_JAVA_MAJOR, ergoRetired } from '@shared/versions'
import {
  chainDb,
  defaultErgo,
  detectErgo,
  ergoUpdate,
  sameErgoLine,
  installedErgo,
  installErgo,
  listErgoReleases,
  removeOtherErgo,
  type ErgoRelease
} from './ergo'
import { HELLO_HASH, readNodeSettings, writeNodeConf } from './ergoConf'
import { detectJre, installJre, jreUpdate, listJreBuilds, removeOtherJres, type JreBuild } from './java'
import { layout } from './layout'
import {
  clientUpdate,
  detectClient,
  installClient,
  installedClients,
  listClientReleases,
  removeOtherClients,
  type ClientRelease
} from './lithosClient'
import { javaMajorSetting, pinnedVersion, updateSettings } from './settings'
import { errorMessage } from './util'
import type { Vault } from './vault'

/** GitHub allows 60 unauthenticated API calls an hour, so release lists are reused for a while. */
const RELEASES_TTL_MS = 30 * 60_000

/** Installs whatever is missing for a network. State is read from disk, never cached. */
export class Installer {
  private busy = false
  private readonly releaseCache = new Map<string, { at: number; list: Promise<unknown> }>()

  constructor(
    private readonly root: string,
    private readonly vault: Vault,
    private readonly emit: (p: TaskProgress) => void
  ) {}

  private nodeDir = (network: Network): string => layout.nodeDir(this.root, network)
  private clientDir = (network: Network): string => layout.clientDir(this.root, network)

  async state(network: Network): Promise<NetworkState> {
    const [java, ergo, client, nodeSettings] = await Promise.all([
      detectJre(this.root),
      detectErgo(this.nodeDir(network), pinnedVersion(network, 'node')),
      detectClient(this.clientDir(network), pinnedVersion(network, 'client')),
      readNodeSettings(this.root, network)
    ])
    return {
      network,
      folder: layout.netDir(this.root, network),
      java: { installed: java !== null, version: java, major: javaMajorSetting() },
      node: {
        installed: ergo !== null,
        version: ergo?.version ?? null,
        retired: ergo ? ergoRetired(ergo.version) : null,
        apiPort: nodeSettings.apiPort
      },
      client: {
        installed: client !== null,
        version: client?.version ?? null,
        retired: client ? clientRetired(client.version) : null
      }
    }
  }

  async install(network: Network): Promise<NetworkState> {
    await this.exclusive(async () => {
      if (!(await detectJre(this.root))) {
        await this.run('java', async () => {
          this.emit({ task: 'java', phase: 'resolving' })
          const major = javaMajorSetting()
          const jre = (await this.javaBuilds(false)).find((b) => b.major === major)
          if (!jre) throw new Error(`No Java ${major} runtime is published for this computer`)
          await installJre(this.root, jre, this.emit)
        })
      }
      const nodeDir = this.nodeDir(network)
      if (!(await detectErgo(nodeDir))) {
        await this.run('node', async () => {
          this.emit({ task: 'node', phase: 'resolving' })
          // An imported chain decides the database; otherwise Ergo's stable line.
          const dataDb = await chainDb(layout.nodeDataDir(this.root, network))
          const release = defaultErgo(await this.ergoReleases(false), dataDb)
          if (!release) {
            throw new Error(`No Ergo node release for ${dataDb ? ERGO_DB_LABEL[dataDb] : 'this network'} was found`)
          }
          await installErgo(nodeDir, release, this.emit)
          await this.unpin(network, 'node')
        })
      }
      await writeNodeConf(this.root, network, this.vault.getNodeKey(network)?.hash ?? HELLO_HASH)
      const clientDir = this.clientDir(network)
      if (!(await detectClient(clientDir))) {
        await this.run('client', async () => {
          this.emit({ task: 'client', phase: 'resolving' })
          const release = (await this.clientReleases(network, false))[0]
          if (!release) throw new Error(`No Lithos Client release was found for ${network}`)
          await installClient(clientDir, release, this.emit)
          await this.unpin(network, 'client')
        })
      }
    })
    return this.state(network)
  }

  async releases(network: Network, id: ProcId, recheck: boolean): Promise<ReleaseList> {
    const state = await this.state(network)
    const { version: active, retired } = state[id]
    if (id === 'node') {
      const [list, dataDb] = await Promise.all([
        this.ergoReleases(recheck),
        chainDb(layout.nodeDataDir(this.root, network))
      ])
      return {
        id,
        network,
        releases: list.map((r) => ({ version: r.version, publishedAt: r.publishedAt, size: r.size, db: ergoDb(r.version) })),
        active,
        update: active && !retired ? ergoUpdate(list, active) : null,
        retired,
        // The newest on the chain's database, else on the retired version's own.
        replacement: retired
          ? (list.find((r) => (dataDb ? ergoDb(r.version) === dataDb : sameErgoLine(r.version, active!)))?.version ?? null)
          : null,
        dataDb
      }
    }
    const list = await this.clientReleases(network, recheck)
    return {
      id,
      network,
      releases: list.map((r) => ({ version: r.version, publishedAt: r.publishedAt, size: r.size, db: null })),
      active,
      update: active && !retired ? clientUpdate(list, active) : null,
      retired,
      replacement: retired ? (list[0]?.version ?? null) : null,
      dataDb: null
    }
  }

  /** Downloads `version` if it isn't installed yet, and makes it the one the launcher runs. */
  async fetchVersion(network: Network, id: ProcId, version: string): Promise<void> {
    const retired = id === 'node' ? ergoRetired(version) : clientRetired(version)
    if (retired) throw new Error(`${id === 'node' ? 'Ergo' : 'Lithos Client'} ${version} is retired: ${retired}`)
    await this.exclusive(async () => {
      if (id === 'node') {
        const dataDb = await chainDb(layout.nodeDataDir(this.root, network))
        const db = ergoDb(version)
        if (dataDb && db && db !== dataDb) {
          throw new Error(
            `This node's chain data is stored in ${ERGO_DB_LABEL[dataDb]}, and Ergo ${version} uses ` +
              `${ERGO_DB_LABEL[db]}, so it can't read it. Pick a ${ERGO_DB_LABEL[dataDb]} version instead.`
          )
        }
        const nodeDir = this.nodeDir(network)
        if (!(await installedErgo(nodeDir)).some((i) => i.version === version)) {
          const release = (await this.ergoReleases(false)).find((r) => r.version === version)
          if (!release) throw new Error(`Ergo ${version} can't be installed by the launcher`)
          await this.run('node', () => installErgo(nodeDir, release, this.emit))
        }
      } else {
        const clientDir = this.clientDir(network)
        if (!(await installedClients(clientDir)).some((c) => c.version === version)) {
          const release = (await this.clientReleases(network, false)).find((r) => r.version === version)
          if (!release) throw new Error(`Lithos Client ${version} is not a ${network} release`)
          await this.run('client', () => installClient(clientDir, release, this.emit))
        }
      }
      await updateSettings((s) => {
        s.versions = { ...s.versions, [network]: { ...s.versions?.[network], [id]: version } }
      })
    })
  }

  async javaReleases(recheck: boolean): Promise<JavaList> {
    const active = javaMajorSetting()
    const [builds, installed] = await Promise.all([this.javaBuilds(recheck), detectJre(this.root)])
    return {
      releases: builds.map(({ major, version, publishedAt, size }) => ({ major, version, publishedAt, size })),
      active,
      installed,
      update: jreUpdate(installed, builds.find((b) => b.major === active)),
      defaultMajor: DEFAULT_JAVA_MAJOR
    }
  }

  /**
   * Installs the newest build of `major` unless it is installed and current, and makes it the Java
   * the node and client run on. `beforeChange` runs right before anything a running program uses
   * changes (once the download is checked and unpacked); it isn't called when nothing changes.
   */
  async fetchJava(major: number, beforeChange: () => Promise<void>): Promise<void> {
    await this.exclusive(async () => {
      const builds = await this.javaBuilds(false)
      const jre = builds.find((b) => b.major === major)
      const installed = await detectJre(this.root, major)
      const needsInstall = !installed || jreUpdate(installed, jre) !== null
      if (!needsInstall && major === javaMajorSetting()) return
      if (needsInstall) {
        if (!jre) throw new Error(`Java ${major} can't be installed by the launcher`)
        // The folder being replaced may be the one in use, so programs stop before the swap.
        await this.run('java', () => installJre(this.root, jre, this.emit, beforeChange))
      } else {
        await beforeChange()
      }
      await updateSettings((s) => {
        if (major === DEFAULT_JAVA_MAJOR) delete s.java
        else s.java = major
      })
    })
  }

  /** Removes the Java versions the launcher no longer runs. */
  async pruneJava(): Promise<void> {
    await removeOtherJres(this.root, javaMajorSetting())
  }

  /** Removes the node or client versions the launcher no longer runs. Files still in use are left. */
  async prune(network: Network, id: ProcId): Promise<void> {
    const active = (await this.state(network))[id].version
    if (!active) return
    if (id === 'node') await removeOtherErgo(this.nodeDir(network), active)
    else await removeOtherClients(this.clientDir(network), active)
  }

  private async unpin(network: Network, id: ProcId): Promise<void> {
    if (!pinnedVersion(network, id)) return
    await updateSettings((s) => {
      delete s.versions?.[network]?.[id]
    })
  }

  private javaBuilds(recheck: boolean): Promise<JreBuild[]> {
    return this.cached('java', recheck, listJreBuilds)
  }

  private ergoReleases(recheck: boolean): Promise<ErgoRelease[]> {
    return this.cached('node', recheck, listErgoReleases)
  }

  private clientReleases(network: Network, recheck: boolean): Promise<ClientRelease[]> {
    return this.cached(`client:${network}`, recheck, () => listClientReleases(network))
  }

  private cached<T>(key: string, recheck: boolean, load: () => Promise<T>): Promise<T> {
    const hit = this.releaseCache.get(key)
    if (hit && !recheck && Date.now() - hit.at < RELEASES_TTL_MS) return hit.list as Promise<T>
    const list = load()
    this.releaseCache.set(key, { at: Date.now(), list })
    // A failed lookup isn't kept, so the next one asks GitHub again.
    list.catch(() => {
      if (this.releaseCache.get(key)?.list === list) this.releaseCache.delete(key)
    })
    return list
  }

  private async exclusive(fn: () => Promise<void>): Promise<void> {
    if (this.busy) throw new Error('An install is already in progress')
    this.busy = true
    try {
      await fn()
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
