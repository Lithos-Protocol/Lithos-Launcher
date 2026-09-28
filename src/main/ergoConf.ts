import { mkdir, readFile } from 'node:fs/promises'
import type { Network } from '@shared/types'
import { layout, NODE_API_PORT } from './layout'
import { writeFileAtomic } from './util'

/** blake2b256("hello"): the documented default key, used only for the first boot. */
export const HELLO_HASH = '324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf'
export const HELLO_KEY = 'hello'

const BEGIN = '# >>> lithos-launcher (managed, edits here are overwritten)'
const END = '# <<< lithos-launcher'

interface NodeConf {
  network: Network
  dataDir: string
  apiPort: number
  apiKeyHash: string
}

/**
 * The launcher-managed part of ergo.conf. Settings placed below the block
 * override it (later keys win in HOCON), so hand edits survive.
 */
function renderNodeBlock(c: NodeConf): string {
  const q = JSON.stringify // JSON strings are valid HOCON quoted strings
  const lines = [
    BEGIN,
    'ergo {',
    `  directory = ${q(c.dataDir)}`,
    `  networkType = ${q(c.network)}`,
    '  node {',
    '    mining = true',
    '    useExternalMiner = true',
    // Ergo's built-in mainnet.conf turns this on, so it has to be switched off explicitly.
    '    offlineGeneration = false',
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
  lines.push('  }', '}', END)
  return lines.join('\n')
}

/** Replaces the managed block in `file`, or prepends one, leaving everything else untouched. */
async function writeManagedBlock(file: string, block: string): Promise<void> {
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const begin = existing.indexOf(BEGIN)
  const end = existing.indexOf(END)
  const next =
    begin !== -1 && end > begin
      ? existing.slice(0, begin) + block + existing.slice(end + END.length)
      : existing.trim()
        ? `${block}\n\n${existing}`
        : `${block}\n`
  await writeFileAtomic(file, next)
}

export async function writeNodeConf(root: string, network: Network, apiKeyHash: string): Promise<void> {
  const dataDir = layout.nodeDataDir(root, network)
  await mkdir(dataDir, { recursive: true })
  await writeManagedBlock(
    layout.ergoConf(root, network),
    renderNodeBlock({ network, dataDir, apiPort: NODE_API_PORT[network], apiKeyHash })
  )
}
