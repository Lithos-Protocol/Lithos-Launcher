import {
  COMMIT_BINDS_BLOCKS,
  COMMIT_REPLACE_BLOCKS,
  COMMIT_SERVED_BLOCKS,
  parseConfigDiff,
  recommendedBalanceNanoErg
} from '@shared/mining'
import { syncView } from '@shared/sync'
import type {
  ApiKeyName,
  ClientSettings,
  ClientSettingsPatch,
  ClientStats,
  CommitmentBlock,
  CommitmentInFlight,
  CommitmentReads,
  CommitmentSent,
  CommitmentState,
  Network,
  NetworkState,
  NodeInfo,
  ProcId,
  ProcState,
  ReleaseList,
  TaskId,
  TaskProgress,
  VaultInfo,
  WalletState
} from '@shared/types'
import { fmtPct, RateTracker } from './format'

const NETWORK_KEY = 'lithos.network'
const AUTOSTART_KEY = 'lithos.autoStartClient'
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

function savedAutoStart(): boolean {
  try {
    return localStorage.getItem(AUTOSTART_KEY) !== 'false'
  } catch {
    return true
  }
}

export const ui = $state({
  network: savedNetwork(),
  net: null as NetworkState | null,
  node: { id: 'node', network: null, status: 'stopped', pid: null, exitCode: null, detail: null, ports: null } as ProcState,
  client: { id: 'client', network: null, status: 'stopped', pid: null, exitCode: null, detail: null, ports: null } as ProcState,
  info: null as NodeInfo | null,
  /** Seconds until the current sync stage finishes, when it can be estimated. */
  syncEta: null as number | null,
  wallet: {
    network: null,
    phase: 'unavailable',
    address: null,
    addressFromPeer: false,
    hasPeerWallet: false,
    keyMatch: null,
    passwordKnown: false,
    balanceNanoErg: null,
    walletHeight: null,
    error: null
  } as WalletState,
  clientSettings: null as ClientSettings | null,
  clientStats: null as ClientStats | null,
  /** Commitments the client read this session, by network; they stay after it stops. */
  commitments: {} as CommitmentReads,
  /** Start the client by itself once everything it needs is ready. */
  autoStartClient: savedAutoStart(),
  /** The user pressed Start and chose to wait for the wallet scan; starts once it catches up. */
  startWhenWalletSynced: false,
  dialog: null as
    | 'difficulty'
    | 'commit'
    | 'miner'
    | 'shares'
    | 'settings'
    | 'import'
    | 'versions'
    | 'walletSync'
    | null,
  quickSetup: false,
  platform: '' as string,
  /** False when Chromium's OS sandbox is off (the AppImage fallback); Settings says so. */
  sandboxed: true,
  appImage: false,
  /** Open wallet wizard, if any. */
  wizard: null as 'create' | 'restore' | 'keystore' | null,
  progress: {} as Partial<Record<TaskId, TaskProgress>>,
  vault: null as VaultInfo | null,
  /** Development only: the client may start before the node is synced. */
  skipSyncGate: false,
  lanAddresses: [] as string[],
  /** One mining key on mainnet and testnet when true (off by default). */
  shareWalletAcrossNetworks: false,
  installing: false,
  /** Node and client releases on GitHub for the selected network; null until checked (or offline). */
  releases: { node: null, client: null } as Record<ProcId, ReleaseList | null>,
  /** The node or client whose version is being switched. */
  switching: null as ProcId | null,
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
  api.onClientStats((st) => (ui.clientStats = st))
  api.onCommitments((c) => (ui.commitments = c))
  api.onProgress((p) => (ui.progress[p.task] = p))

  const [app, node, client, info, wallet, stats, commitments] = await Promise.all([
    api.getAppInfo(),
    api.getProc('node'),
    api.getProc('client'),
    api.getNodeInfo(),
    api.focusWallet(ui.network),
    api.getClientStats(),
    api.getCommitments()
  ])
  ui.commitments = commitments
  ui.platform = app.platform
  ui.sandboxed = app.sandboxed
  ui.appImage = app.appImage
  ui.clientStats = stats
  ui.vault = app.vault
  ui.skipSyncGate = app.skipSyncGate
  ui.lanAddresses = app.lanAddresses
  ui.shareWalletAcrossNetworks = app.shareWalletAcrossNetworks
  ui.node = node
  ui.client = client
  ui.wallet = wallet
  applyNodeInfo(info)
  await refresh()
  // First launch: nothing installed yet, so offer the guided setup.
  ui.quickSetup = ui.net !== null && !ui.net.java.installed
}

export async function refresh(): Promise<void> {
  const network = ui.network
  const [state, settings] = await Promise.all([api.getState(network), api.getClientSettings(network)])
  if (network === ui.network) {
    ui.net = state
    ui.clientSettings = settings
  }
  // Quietly looks for newer releases; GitHub is only asked again after a while.
  if (state.node.installed || state.client.installed) void loadReleases(false).catch(() => undefined)
}

/** Fetches both release lists for the selected network. Throws if GitHub can't be reached. */
export async function loadReleases(recheck: boolean): Promise<void> {
  const network = ui.network
  const [node, client] = await Promise.all([
    api.getReleases(network, 'node', recheck),
    api.getReleases(network, 'client', recheck)
  ])
  if (network === ui.network) ui.releases = { node, client }
}

/** Switches the node or client to `version`, restarting it if it runs. Returns an error message, or null. */
export async function useVersion(id: ProcId, version: string): Promise<string | null> {
  const network = ui.network
  ui.switching = id
  delete ui.progress[id]
  try {
    const state = await api.useVersion(network, id, version)
    if (state.network === ui.network) ui.net = state
    await loadReleases(false).catch(() => undefined)
    return null
  } catch (err) {
    await refresh()
    return errorText(err)
  } finally {
    ui.switching = null
  }
}

export async function setNetwork(network: Network): Promise<void> {
  if (network === ui.network) return
  ui.network = network
  ui.net = null
  ui.clientSettings = null
  ui.releases = { node: null, client: null }
  ui.setupError = null
  ui.progress = {}
  // Blank until the main process reports this network's wallet: the other network's address
  // may belong to a different key, so it is never carried over.
  ui.wallet = {
    network,
    phase: 'unavailable',
    address: null,
    addressFromPeer: false,
    hasPeerWallet: false,
    keyMatch: null,
    passwordKnown: false,
    balanceNanoErg: null,
    walletHeight: null,
    error: null
  }
  try {
    localStorage.setItem(NETWORK_KEY, network)
  } catch {
    // not critical
  }
  ui.wallet = await api.focusWallet(network)
  await refresh()
}

/** Saves the shared-wallet preference and refreshes wallet state to match. */
export async function setShareWalletAcrossNetworks(on: boolean): Promise<void> {
  const info = await api.setShareWalletAcrossNetworks(on)
  ui.shareWalletAcrossNetworks = info.shareWalletAcrossNetworks
  ui.wallet = await api.focusWallet(ui.network)
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

/** Copies an API key in the main process, so it never reaches this window. Returns an error message, or null. */
export async function copyApiKey(network: Network, name: ApiKeyName): Promise<string | null> {
  try {
    await api.copyApiKey(network, name)
    return null
  } catch (err) {
    return errorText(err)
  }
}

/**
 * Starts the client. `testMode` picks test mining (no transactions) or real mining and is saved
 * with the other client settings; left out, the client runs the way it last did.
 */
export async function startClient(testMode?: boolean): Promise<void> {
  ui.clientError = null
  try {
    if (testMode !== undefined && ui.clientSettings?.forceConfigDiff !== testMode) {
      ui.clientSettings = await api.setClientSettings(ui.network, { forceConfigDiff: testMode })
    }
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

export async function restartClient(): Promise<void> {
  ui.clientError = null
  try {
    await api.restartClient(ui.network)
  } catch (err) {
    ui.clientError = errorText(err)
  }
}

/** Saves mining settings for the selected network. Returns an error message, or null. */
export async function saveClientSettings(patch: ClientSettingsPatch): Promise<string | null> {
  try {
    ui.clientSettings = await api.setClientSettings(ui.network, patch)
    return null
  } catch (err) {
    return errorText(err)
  }
}

export function setAutoStartClient(on: boolean): void {
  ui.autoStartClient = on
  try {
    localStorage.setItem(AUTOSTART_KEY, String(on))
  } catch {
    // not critical
  }
}

export interface Requirement {
  label: string
  ok: boolean
  note: string
  /** Real mining waits for it (or asks); test mining, which sends no transactions, doesn't need it. */
  soft?: boolean
}

/** Blocks the wallet may trail the chain by and still count as caught up. */
const WALLET_SLACK_BLOCKS = 3

/**
 * How far the unlocked wallet has scanned while it trails the chain: after a restore or keystore
 * import it rescans the whole chain. Null once caught up, or while its height isn't known.
 */
export function walletScan(): { height: number; tip: number } | null {
  const w = ui.wallet
  // The node info is the running node's; it says nothing about a wallet on the other network.
  const tip = ui.node.status === 'running' && ui.node.network === w.network ? (ui.info?.fullHeight ?? null) : null
  if (w.phase !== 'unlocked' || w.walletHeight === null || tip === null) return null
  return w.walletHeight < tip - WALLET_SLACK_BLOCKS ? { height: w.walletHeight, tip } : null
}

/** What the Lithos Client needs before it can start on the selected network. */
export function clientRequirements(): Requirement[] {
  const nodeUp = ui.node.status === 'running' && ui.node.network === ui.network
  const synced = nodeUp && ui.info !== null && syncView(ui.info).stage === 'synced'
  const unlocked = ui.wallet.phase === 'unlocked' && ui.wallet.network === ui.network
  const scan = walletScan()
  return [
    {
      label: 'Client installed',
      ok: (ui.net?.client.installed ?? false) && !ui.net?.client.retired,
      note: ui.net?.client.retired ? 'version retired' : ''
    },
    { label: 'Node running', ok: nodeUp, note: '' },
    {
      label: 'Node synced',
      ok: synced || (ui.skipSyncGate && nodeUp),
      note: ui.skipSyncGate && !synced ? 'skipped (dev)' : ''
    },
    { label: 'Wallet unlocked', ok: unlocked, note: '' },
    // The client funds bonds and fees from this wallet; until the scan reaches the tip the node
    // doesn't know all of its boxes.
    {
      label: 'Wallet synced',
      ok: unlocked && ui.wallet.walletHeight !== null && scan === null,
      note: scan ? `scanning, ${fmtPct(scan.height / scan.tip)}` : '',
      soft: true
    },
    { label: 'Difficulty chosen', ok: Boolean(ui.clientSettings?.diff), note: '' }
  ]
}

export interface ChainCommitment {
  /** Score NISPs are judged against now; null until any commitment has taken effect. */
  committed: number | null
  /** A newer commitment still waiting to take effect at `fromHeight`, if the chain hasn't got there. */
  pending: number | null
  fromHeight: number | null
  /** The newest commitment on chain, in effect or not. */
  latest: number | null
  /** Best known chain height, or null when neither the client nor the node has reported one. */
  height: number | null
  /** Blocks until `pending` takes effect, when the height is known. */
  blocksLeft: number | null
  /** The height `pending` declares: super shares count toward it from here. */
  declaredHeight: number | null
  /** The first block the stratum mines at `pending`: rigs should start (or switch) here. */
  servedHeight: number | null
  /** Blocks until `servedHeight`, when the height is known; 0 once it's reached. */
  blocksToServed: number | null
  /** Nothing is in effect yet and the first commitment is still waiting. */
  waiting: boolean
  /** Waiting, and the served height isn't known to be reached: mining now isn't paid. */
  early: boolean
  /** A registration or change that was sent and hasn't confirmed or been synced yet. */
  inFlight: CommitmentInFlight | null
  state: CommitmentState
  /** What the client is waiting on, when it says. */
  reason: string | null
  /** Whether the client would send a commitment now (as of its last read). */
  canCommit: boolean
  blockedReason: CommitmentBlock | null
  /** The first height the newest commitment can be replaced at. */
  replaceableFromHeight: number | null
  blocksToReplaceable: number | null
  /** Read through the client's commitment API; false for an older client, which can't commit from here. */
  api: boolean
  /** Read by the client running now, rather than remembered from an earlier run this session. */
  live: boolean
  /** The height the client read it at, when it says. */
  readAt: number | null
}

/** This miner's commitment as the client last read it this session on the selected network, or null. */
export function chainCommitment(): ChainCommitment | null {
  const network = ui.network
  const read = ui.commitments[network]
  if (!read) return null
  // Both heights are polled anyway, so the newer of the two costs no extra node calls.
  const nodeHeight = ui.node.status === 'running' && ui.node.network === network ? ui.info?.fullHeight : null
  const height = Math.max(read.height ?? 0, nodeHeight ?? 0) || null
  const p = read.pending
  const from = p?.inForceFromHeight ?? null
  const ahead = p !== null && (from === null || height === null || height < from)
  const reported = read.inForce ? Number(read.inForce.score) : null
  const newest = p ? Number(p.score) : null
  const pending = ahead ? newest : null
  // Past its height the pending one is in effect, even before the client reads it again.
  const committed = ahead ? reported : (newest ?? reported)
  const served = ahead ? (p!.servedFromHeight ?? p!.declaredHeight) : null
  const blocksToServed = served !== null && height !== null ? Math.max(0, served - height) : null
  const waiting = ahead && committed === null
  const replaceable = read.replaceableFromHeight
  return {
    committed,
    pending,
    fromHeight: ahead ? from : null,
    latest: pending ?? committed,
    height,
    blocksLeft: ahead && from !== null && height !== null ? from - height : null,
    declaredHeight: ahead ? p!.declaredHeight : null,
    servedHeight: served,
    blocksToServed,
    waiting,
    early: waiting && (blocksToServed === null || blocksToServed > 0),
    inFlight: read.inFlight,
    state: read.state,
    reason: read.reason,
    canCommit: read.canCommit,
    blockedReason: read.blockedReason,
    replaceableFromHeight: replaceable,
    blocksToReplaceable: replaceable !== null && height !== null ? Math.max(0, replaceable - height) : null,
    api: read.api,
    live: ui.client.status === 'running' && ui.client.network === network,
    readAt: read.height
  }
}

/** Blocks from sending a commitment until each step, as the client reports them (or the launcher's defaults). */
export function commitTiming(): { served: number; inForce: number; replaceable: number } {
  const t = ui.commitments[ui.network]?.timing
  return {
    served: t?.servedAfterBlocks ?? COMMIT_SERVED_BLOCKS,
    inForce: t?.inForceAfterBlocks ?? COMMIT_BINDS_BLOCKS,
    replaceable: t?.replaceableAfterBlocks ?? COMMIT_REPLACE_BLOCKS
  }
}

/** Has the running client read the commitment again. Quiet on failure: the last read stays. */
export async function refreshCommitment(): Promise<void> {
  if (ui.client.status !== 'running' || ui.client.network !== ui.network) return
  await api.refreshCommitment(ui.network).catch(() => undefined)
}

/** Sends a commitment of `diff` through the running client. */
export async function commit(diff: string): Promise<{ sent: CommitmentSent } | { error: string }> {
  try {
    return { sent: await api.commit(ui.network, diff) }
  } catch (err) {
    return { error: errorText(err) }
  }
}

/**
 * The balance to keep for committing and proofs, sized for the higher of the chosen and committed
 * difficulty: proofs bond at the committed score, and a higher chosen one may be committed next.
 */
export function miningBalanceTarget(): { nanoErg: number; diff: number | null } {
  const diff = Math.max(parseConfigDiff(ui.clientSettings?.diff) ?? 0, chainCommitment()?.latest ?? 0) || null
  return { nanoErg: recommendedBalanceNanoErg(diff), diff }
}

/** The Start button (real mining): straight away if the wallet has caught up, otherwise ask whether to wait. */
export function requestStartClient(): void {
  if (clientRequirements().every((r) => r.ok)) void startClient(false)
  else ui.dialog = 'walletSync'
}
