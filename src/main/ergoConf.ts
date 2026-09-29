import { mkdir } from 'node:fs/promises'
import { DEFAULT_OFFLINE_GENERATION, type Network, type NodeSettings, type NodeSettingsPatch } from '@shared/types'
import { layout, NODE_API_PORT } from './layout'
import { readManagedValue, updateManagedLines, writeManagedBlock } from './managedBlock'

/** blake2b256("hello"): the documented default key, used only for the first boot. */
export const HELLO_HASH = '324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf'
export const HELLO_KEY = 'hello'

// Settings the user can change are written as top-level dotted keys, one per line, so they can be
// read back from the managed block (and a later key overrides the nested block above it in HOCON).
const KEYS = {
  offlineGeneration: 'ergo.node.offlineGeneration'
} as const

/** Settings from the managed block; the node's own per-network default when never changed. */
export async function readNodeSettings(root: string, network: Network): Promise<NodeSettings> {
  const raw = await readManagedValue(layout.ergoConf(root, network), KEYS.offlineGeneration)
  return {
    offlineGeneration: raw === 'true' ? true : raw === 'false' ? false : DEFAULT_OFFLINE_GENERATION[network]
  }
}

/** Saves node settings; the node reads them on its next start. */
export async function updateNodeSettings(
  root: string,
  network: Network,
  patch: NodeSettingsPatch
): Promise<NodeSettings> {
  const entries: Record<string, string> = {}
  if (patch.offlineGeneration !== undefined) entries[KEYS.offlineGeneration] = String(patch.offlineGeneration)
  await mkdir(layout.nodeDir(root, network), { recursive: true })
  await updateManagedLines(layout.ergoConf(root, network), entries)
  return readNodeSettings(root, network)
}

interface NodeConf {
  network: Network
  dataDir: string
  apiPort: number
  apiKeyHash: string
  settings: NodeSettings
}

/** The launcher-managed part of ergo.conf. */
function nodeBlock(c: NodeConf): string[] {
  const q = JSON.stringify // JSON strings are valid HOCON quoted strings
  const lines = [
    'ergo {',
    `  directory = ${q(c.dataDir)}`,
    `  networkType = ${q(c.network)}`,
    '  node {',
    '    mining = true',
    '    useExternalMiner = true',
    '    extraIndex = true',
    // The node defaults to "random"; the Lithos Client expects its node.mempoolSorting to match ("bySize").
    '    mempoolSorting = "bySize"',
    '  }'
  ]
  if (c.network === 'mainnet') {
    lines.push('  chain.reemission.checkReemissionRules = true', '  wallet.checkEIP27 = true')
  } else {
    lines.push(
      '  chain.voting.version2ActivationHeight = 2147483647',
      '  chain.voting.version2ActivationDifficultyHex = "20"'
    )
  }
  lines.push(
    '}',
    'scorex {',
    '  restApi {',
    // Ergo binds to 0.0.0.0 by default; keep the API on this machine only.
    `    bindAddress = ${q(`127.0.0.1:${c.apiPort}`)}`,
    `    apiKeyHash = ${q(c.apiKeyHash)}`,
    '  }',
    '  network {',
    `    nodeName = ${q(`lithos-${c.network}-node`)}`
  )
  if (c.network === 'testnet') {
    lines.push('    knownPeers = ["128.253.41.110:9020"]', '    peerDiscovery = true')
  }
  lines.push('  }', '}')
  // Always written, so the file says what the node runs with. Ergo's mainnet.conf turns it on.
  lines.push(`${KEYS.offlineGeneration} = ${c.settings.offlineGeneration}`)
  return lines
}

export async function writeNodeConf(root: string, network: Network, apiKeyHash: string): Promise<void> {
  const dataDir = layout.nodeDataDir(root, network)
  await mkdir(dataDir, { recursive: true })
  const settings = await readNodeSettings(root, network)
  await writeManagedBlock(
    layout.ergoConf(root, network),
    nodeBlock({ network, dataDir, apiPort: NODE_API_PORT[network], apiKeyHash, settings })
  )
}
