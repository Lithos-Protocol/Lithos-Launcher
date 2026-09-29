import { syncView } from '@shared/sync'
import type {
  Network,
  NetworkState,
  NodeInfo,
  ProcState,
  TaskId,
  TaskProgress,
  VaultInfo,
  WalletState
} from '@shared/types'
import { RateTracker } from './format'

const NETWORK_KEY = 'lithos.network'
const api = window.lithos
const syncRate = new RateTracker()

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
  node: { id: 'node', network: null, status: 'stopped', pid: null, exitCode: null, detail: null, ports: null } as ProcState,
  client: { id: 'client', network: null, status: 'stopped', pid: null, exitCode: null, detail: null, ports: null } as ProcState,
  info: null as NodeInfo | null,
  /** Seconds until the current sync stage finishes, when it can be estimated. */
  syncEta: null as number | null,
  wallet: { network: null, phase: 'unavailable', address: null, passwordKnown: false, error: null } as WalletState,
  /** Open wallet wizard, if any. */
  wizard: null as 'create' | 'restore' | null,
  progress: {} as Partial<Record<TaskId, TaskProgress>>,
  vault: null as VaultInfo | null,
  /** Development only: the client may start before the node is synced. */
  skipSyncGate: false,
  lanAddresses: [] as string[],
  installing: false,
  setupError: null as string | null,
  nodeError: null as string | null,
  clientError: null as string | null
})

/** Strips Electron's "Error invoking remote method ..." wrapper. */
export function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

function applyNodeInfo(info: NodeInfo | null): void {
  ui.info = info
  if (!info) {
    syncRate.reset()
    ui.syncEta = null
    return
  }
  const v = syncView(info)
  const current = v.stage === 'headers' ? v.headers : v.stage === 'blocks' ? v.blocks : v.stage === 'indexing' ? v.indexed : null
  ui.syncEta = current === null ? null : syncRate.eta(v.stage, current, v.target)
}

export async function init(): Promise<void> {
  api.onProcState((s) => {
    if (s.id === 'node') ui.node = s
    else ui.client = s
  })
  api.onNodeInfo(applyNodeInfo)
  api.onWallet((w) => (ui.wallet = w))
  api.onProgress((p) => (ui.progress[p.task] = p))

  const [app, node, client, info, wallet] = await Promise.all([
    api.getAppInfo(),
    api.getProc('node'),
    api.getProc('client'),
    api.getNodeInfo(),
    api.getWallet()
  ])
  ui.vault = app.vault
  ui.skipSyncGate = app.skipSyncGate
  ui.lanAddresses = app.lanAddresses
  ui.node = node
  ui.client = client
  ui.wallet = wallet
  applyNodeInfo(info)
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

/** Returns an error message, or null on success. */
export async function unlockWallet(password: string, remember: boolean): Promise<string | null> {
  try {
    await api.unlockWallet(password, remember)
    return null
  } catch (err) {
    return errorText(err)
  }
}

export function copyText(text: string): Promise<void> {
  return api.copyText(text)
}

export async function startClient(): Promise<void> {
  ui.clientError = null
  try {
    await api.startClient(ui.network)
  } catch (err) {
    ui.clientError = errorText(err)
  }
}

export async function stopClient(): Promise<void> {
  ui.clientError = null
  try {
    await api.stopClient()
  } catch (err) {
    ui.clientError = errorText(err)
  }
}

export async function openLithosPanel(): Promise<void> {
  try {
    await api.openLithosPanel()
  } catch (err) {
    ui.clientError = errorText(err)
  }
}
