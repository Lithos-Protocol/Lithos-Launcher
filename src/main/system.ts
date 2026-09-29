import { access, statfs } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { dirname } from 'node:path'
import type { Network, SystemCheck } from '@shared/types'
import { readClientSettings } from './clientConf'
import { NODE_API_PORT, NODE_P2P_PORT } from './layout'
import { isPortListening } from './util'

/** Free bytes on the drive that holds `path` (or its nearest existing parent). */
async function freeBytes(path: string): Promise<number | null> {
  let dir = path
  for (;;) {
    try {
      await access(dir)
      break
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
  try {
    const s = await statfs(dir)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

/** What Quick setup checks before installing: memory, disk space and the ports everything needs. */
export async function systemCheck(root: string, network: Network): Promise<SystemCheck> {
  const settings = await readClientSettings(root, network)
  const wanted = [
    { port: NODE_API_PORT[network], label: 'Node API' },
    { port: NODE_P2P_PORT[network], label: 'Node peers' },
    { port: settings.httpPort, label: 'Lithos panel' },
    { port: settings.stratumPort, label: 'Stratum' }
  ]
  const ports = await Promise.all(wanted.map(async (p) => ({ ...p, free: !(await isPortListening(p.port)) })))
  return { totalMemBytes: totalmem(), freeDiskBytes: await freeBytes(root), installRoot: root, ports }
}
