import { homedir, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import type { Network } from '@shared/types'

const EXE = process.platform === 'win32' ? '.exe' : ''

/**
 * Everything the launcher installs lives under one root, `~/Lithos` by default.
 * LITHOS_LAUNCHER_ROOT overrides it for development and testing.
 */
export function installRoot(): string {
  return resolve(process.env.LITHOS_LAUNCHER_ROOT || join(homedir(), 'Lithos'))
}

export const layout = {
  javaDir: (root: string) => join(root, 'java', 'temurin-11-jre'),
  javaBin: (root: string) => join(root, 'java', 'temurin-11-jre', 'bin', `java${EXE}`),
  netDir: (root: string, net: Network) => join(root, net),
  nodeDir: (root: string, net: Network) => join(root, net, 'node'),
  nodeDataDir: (root: string, net: Network) => join(root, net, 'node', '.ergo'),
  ergoConf: (root: string, net: Network) => join(root, net, 'node', 'ergo.conf')
}

export const NODE_API_PORT: Record<Network, number> = { mainnet: 9053, testnet: 9052 }

/** JVM heap limits sized from system RAM. Starting points; tune with real usage. */
export function heapPlan(totalBytes = totalmem()): { nodeMb: number; clientMb: number } {
  const gb = totalBytes / 2 ** 30
  if (gb < 12) return { nodeMb: 3072, clientMb: 2048 }
  if (gb < 24) return { nodeMb: 4096, clientMb: 3072 }
  return { nodeMb: 6144, clientMb: 4096 }
}

/** Environment for Java child processes: our JRE, and no user-level JVM flag injection. */
export function javaEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, JAVA_HOME: layout.javaDir(root) }
  for (const key of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'JAVA_OPTS', 'ELECTRON_RUN_AS_NODE']) {
    delete env[key]
  }
  return env
}
