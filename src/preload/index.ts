import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type LauncherApi } from '@shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// The renderer gets these named calls only; no raw ipcRenderer, no Node APIs.
const api: LauncherApi = {
  getState: (network) => ipcRenderer.invoke(IPC.getState, network),
  getVaultInfo: () => ipcRenderer.invoke(IPC.getVaultInfo),
  install: (network) => ipcRenderer.invoke(IPC.install, network),
  startNode: (network) => ipcRenderer.invoke(IPC.startNode, network),
  stopNode: () => ipcRenderer.invoke(IPC.stopNode),
  getProc: (id) => ipcRenderer.invoke(IPC.getProc, id),
  getLogs: (id) => ipcRenderer.invoke(IPC.getLogs, id),
  getNodeInfo: () => ipcRenderer.invoke(IPC.getNodeInfo),
  openNodePanel: () => ipcRenderer.invoke(IPC.openNodePanel),
  openFolder: (network) => ipcRenderer.invoke(IPC.openFolder, network),
  getWallet: () => ipcRenderer.invoke(IPC.getWallet),
  createWallet: (password) => ipcRenderer.invoke(IPC.createWallet, password),
  restoreWallet: (mnemonic, password) => ipcRenderer.invoke(IPC.restoreWallet, mnemonic, password),
  unlockWallet: (password, remember) => ipcRenderer.invoke(IPC.unlockWallet, password, remember),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  setSensitive: (on) => ipcRenderer.invoke(IPC.setSensitive, on),
  onProgress: (cb) => subscribe(IPC.progress, cb),
  onProcState: (cb) => subscribe(IPC.procState, cb),
  onLogs: (cb) => subscribe(IPC.logs, cb),
  onNodeInfo: (cb) => subscribe(IPC.nodeInfo, cb),
  onWallet: (cb) => subscribe(IPC.wallet, cb)
}

contextBridge.exposeInMainWorld('lithos', api)
