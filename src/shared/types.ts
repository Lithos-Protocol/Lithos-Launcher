// Types and channel names shared by the main process, preload and renderer.
// This file must stay free of Node and DOM imports.

export type Network = 'mainnet' | 'testnet'
export const NETWORKS: readonly Network[] = ['mainnet', 'testnet']

export function isNetwork(value: unknown): value is Network {
  return typeof value === 'string' && (NETWORKS as readonly string[]).includes(value)
}

export type ProcId = 'node' | 'client'
export type ProcStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

export interface ComponentState {
  installed: boolean
  version: string | null
}

export interface NetworkState {
  network: Network
  /** Folder holding this network's node and client, for display only. */
  folder: string
  java: ComponentState
  node: ComponentState & { apiPort: number }
}

export interface ProcState {
  id: ProcId
  network: Network | null
  status: ProcStatus
  pid: number | null
  exitCode: number | null
  /** Short human-readable detail, e.g. "Waiting for the node API". */
  detail: string | null
}

export interface NodeInfo {
  appVersion: string | null
  fullHeight: number | null
  headersHeight: number | null
  maxPeerHeight: number | null
  peersCount: number
  indexedHeight: number | null
}

export type WalletPhase = 'unavailable' | 'uninitialized' | 'locked' | 'unlocking' | 'unlocked'

export interface WalletState {
  /** Network of the running node, or null when no node is running. */
  network: Network | null
  phase: WalletPhase
  /** The wallet's change address; only known while unlocked. */
  address: string | null
  /** The launcher holds this wallet's password (saved, or for this session only). */
  passwordKnown: boolean
  error: string | null
}

/** Seed phrase word counts the node accepts. */
export const MNEMONIC_LENGTHS = [12, 15, 18, 21, 24] as const
export const MIN_PASSWORD_LENGTH = 8

export type TaskId = 'java' | 'node'
export type TaskPhase = 'resolving' | 'downloading' | 'extracting' | 'done' | 'error'

export interface TaskProgress {
  task: TaskId
  phase: TaskPhase
  received?: number
  total?: number
  message?: string
}

/** A run of log lines; `start` is the sequence number of the first line. */
export interface LogChunk {
  proc: ProcId
  start: number
  lines: string[]
}

export interface VaultInfo {
  /** False when secrets would be stored without real OS encryption (Linux with no keyring). */
  secure: boolean
  backend: string
}

export interface LauncherApi {
  getState(network: Network): Promise<NetworkState>
  getVaultInfo(): Promise<VaultInfo>
  install(network: Network): Promise<NetworkState>
  startNode(network: Network): Promise<void>
  stopNode(): Promise<void>
  getProc(id: ProcId): Promise<ProcState>
  getLogs(id: ProcId): Promise<LogChunk>
  getNodeInfo(): Promise<NodeInfo | null>
  openNodePanel(): Promise<void>
  openFolder(network: Network): Promise<void>
  getWallet(): Promise<WalletState>
  /** Creates the node wallet and returns its seed words. They are shown once and never stored. */
  createWallet(password: string): Promise<string[]>
  restoreWallet(mnemonic: string, password: string): Promise<void>
  /** `remember` saves the password to the vault; it is always kept for the session. */
  unlockWallet(password: string, remember: boolean): Promise<void>
  copyText(text: string): Promise<void>
  /** Hides the window from screenshots/screen recording while secrets are on screen. */
  setSensitive(on: boolean): Promise<void>
  onProgress(cb: (p: TaskProgress) => void): () => void
  onProcState(cb: (s: ProcState) => void): () => void
  onLogs(cb: (chunk: LogChunk) => void): () => void
  onNodeInfo(cb: (info: NodeInfo | null) => void): () => void
  onWallet(cb: (w: WalletState) => void): () => void
}

export const IPC = {
  getState: 'launcher:get-state',
  getVaultInfo: 'launcher:get-vault-info',
  install: 'launcher:install',
  startNode: 'node:start',
  stopNode: 'node:stop',
  getProc: 'proc:get',
  getLogs: 'proc:get-logs',
  getNodeInfo: 'node:get-info',
  openNodePanel: 'node:open-panel',
  openFolder: 'launcher:open-folder',
  getWallet: 'wallet:get',
  createWallet: 'wallet:create',
  restoreWallet: 'wallet:restore',
  unlockWallet: 'wallet:unlock',
  copyText: 'launcher:copy-text',
  setSensitive: 'launcher:set-sensitive',
  // main -> renderer
  progress: 'evt:progress',
  procState: 'evt:proc-state',
  logs: 'evt:logs',
  nodeInfo: 'evt:node-info',
  wallet: 'evt:wallet'
} as const
