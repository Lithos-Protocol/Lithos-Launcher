import type { Network, NetworkState, NodeInfo, ProcState, TaskId, TaskProgress, VaultInfo } from '@shared/types'

const NETWORK_KEY = 'lithos.network'
const api = window.lithos

function savedNetwork(): Network {
  try {
    const value = localStorage.getItem(NETWORK_KEY)
    if (value === 'mainnet' || value === 'testnet') return value
  } catch {
    // storage unavailable; fall through to the default
  }
  return 'mainnet'
}

export const ui = $state({
  network: savedNetwork(),
  net: null as NetworkState | null,
  node: { id: 'node', network: null, status: 'stopped', pid: null, exitCode: null, detail: null } as ProcState,
  info: null as NodeInfo | null,
  progress: {} as Partial<Record<TaskId, TaskProgress>>,
  vault: null as VaultInfo | null,
  installing: false,
  setupError: null as string | null,
  nodeError: null as string | null
})

/** Strips Electron's "Error invoking remote method ..." wrapper. */
export function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export async function init(): Promise<void> {
  api.onProcState((s) => {
    if (s.id === 'node') ui.node = s
  })
  api.onNodeInfo((info) => (ui.info = info))
  api.onProgress((p) => (ui.progress[p.task] = p))

  const [vault, node, info] = await Promise.all([api.getVaultInfo(), api.getProc('node'), api.getNodeInfo()])
  ui.vault = vault
  ui.node = node
  ui.info = info
  await refresh()
}

export async function refresh(): Promise<void> {
  const state = await api.getState(ui.network)
  if (state.network === ui.network) ui.net = state
}

export async function setNetwork(network: Network): Promise<void> {
  if (network === ui.network) return
  ui.network = network
  ui.net = null
  ui.setupError = null
  ui.progress = {}
  try {
    localStorage.setItem(NETWORK_KEY, network)
  } catch {
    // not critical
  }
  await refresh()
}

export async function install(): Promise<void> {
  ui.installing = true
  ui.setupError = null
  ui.progress = {}
  try {
    const state = await api.install(ui.network)
    if (state.network === ui.network) ui.net = state
  } catch (err) {
    ui.setupError = errorText(err)
    await refresh()
  } finally {
    ui.installing = false
  }
}

export async function startNode(): Promise<void> {
  ui.nodeError = null
  try {
    await api.startNode(ui.network)
  } catch (err) {
    ui.nodeError = errorText(err)
  }
}

export async function stopNode(): Promise<void> {
  ui.nodeError = null
  try {
    await api.stopNode()
  } catch (err) {
    ui.nodeError = errorText(err)
  }
}

export async function openNodePanel(): Promise<void> {
  try {
    await api.openNodePanel()
  } catch (err) {
    ui.nodeError = errorText(err)
  }
}

export async function openFolder(): Promise<void> {
  try {
    await api.openFolder(ui.network)
  } catch (err) {
    ui.setupError = errorText(err)
  }
}
