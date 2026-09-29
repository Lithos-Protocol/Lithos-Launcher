import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Network } from '@shared/types'
import { CLIENT_DEFAULT_PORTS, layout } from './layout'
import { readManagedNumber, writeManagedBlock } from './managedBlock'

/** Environment variables the client reads its secrets from (names from the client README). */
export const CLIENT_ENV = {
  nodeKey: 'NODE_KEY_ENV',
  nodePass: 'NODE_PASS_ENV',
  playSecret: 'PLAY_ENV'
} as const

export interface ClientPorts {
  http: number
  stratum: number
}

/** Ports from the managed block, so a choice made earlier (or by Advanced setup) sticks. */
export async function clientPorts(root: string, network: Network): Promise<ClientPorts> {
  const file = layout.clientConf(root, network)
  return {
    http: (await readManagedNumber(file, 'play.server.http.port')) ?? CLIENT_DEFAULT_PORTS.http,
    stratum: (await readManagedNumber(file, 'stratum.stratumPort')) ?? CLIENT_DEFAULT_PORTS.stratum
  }
}

interface ClientConf {
  network: Network
  appHome: string
  keystore: string
  lithosApiKeyHash: string
  ports: ClientPorts
}

/**
 * The launcher-managed part of lithos.conf. No secrets: the node API key, wallet
 * password and Play secret are substituted from environment variables at start.
 */
function clientBlock(c: ClientConf): string[] {
  const q = JSON.stringify // JSON strings are valid HOCON quoted strings
  const env = (name: string): string => `\${?${name}}`
  return [
    // Absolute path: include file() resolves relative paths against the working directory.
    `include file(${q(join(c.appHome, 'conf', 'application.conf'))})`,
    'node {',
    // The client appends the network's default node port (9053 / 9052) itself.
    '  url = "http://127.0.0.1"',
    `  key = ${env(CLIENT_ENV.nodeKey)}`,
    `  storagePath = ${q(c.keystore)}`,
    `  pass = ${env(CLIENT_ENV.nodePass)}`,
    `  networkType = ${q(c.network.toUpperCase())}`,
    // Must match the node's ergo.node.mempoolSorting, which the launcher sets to bySize.
    '  mempoolSorting = "bySize"',
    '}',
    `play.http.secret.key = ${env(CLIENT_ENV.playSecret)}`,
    // Play listens on 0.0.0.0 by default; keep the panel and API on this machine.
    // Stratum has no bind setting and listens on all interfaces, which rigs on the LAN need.
    'play.server.http.address = "127.0.0.1"',
    `play.server.http.port = ${c.ports.http}`,
    `stratum.stratumPort = ${c.ports.stratum}`,
    `lithos.apiKeyHash = ${q(c.lithosApiKeyHash)}`
  ]
}

export async function writeClientConf(root: string, conf: Omit<ClientConf, 'ports'> & { ports?: ClientPorts }) {
  const ports = conf.ports ?? (await clientPorts(root, conf.network))
  await mkdir(layout.clientDir(root, conf.network), { recursive: true })
  await writeManagedBlock(layout.clientConf(root, conf.network), clientBlock({ ...conf, ports }))
  return ports
}
