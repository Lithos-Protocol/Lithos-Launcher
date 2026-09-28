import { mkdir } from 'node:fs/promises'
import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC, isNetwork, type LogChunk, type Network, type ProcId, type ProcState } from '@shared/types'
import type { Installer } from './installer'
import { layout, NODE_API_PORT } from './layout'
import type { NodeController } from './nodeController'
import type { Vault } from './vault'

interface IpcContext {
  window: () => BrowserWindow | null
  root: string
  vault: Vault
  installer: Installer
  node: NodeController
}

// Placeholder until the Lithos Client is wired up.
const CLIENT_STATE: ProcState = { id: 'client', network: null, status: 'stopped', pid: null, exitCode: null, detail: null }
const CLIENT_LOGS: LogChunk = { proc: 'client', start: 0, lines: [] }

function asNetwork(value: unknown): Network {
  if (!isNetwork(value)) throw new Error('Invalid network')
  return value
}

function asProcId(value: unknown): ProcId {
  if (value !== 'node' && value !== 'client') throw new Error('Invalid process id')
  return value
}

export function registerIpc(ctx: IpcContext): void {
  // Only the top frame of our own window may call in.
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const win = ctx.window()
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame?.parent !== null) {
        throw new Error('Unauthorized IPC sender')
      }
      return fn(...args)
    })
  }

  handle(IPC.getState, (n) => ctx.installer.state(asNetwork(n)))
  handle(IPC.getVaultInfo, () => ctx.vault.info)
  handle(IPC.install, (n) => ctx.installer.install(asNetwork(n)))
  handle(IPC.startNode, (n) => ctx.node.start(asNetwork(n)))
  handle(IPC.stopNode, () => ctx.node.stop())
  handle(IPC.getProc, (id) => (asProcId(id) === 'node' ? ctx.node.proc.state : CLIENT_STATE))
  handle(IPC.getLogs, (id) => (asProcId(id) === 'node' ? ctx.node.proc.snapshot() : CLIENT_LOGS))
  handle(IPC.getNodeInfo, () => ctx.node.info)

  handle(IPC.openNodePanel, async () => {
    const network = ctx.node.runningNetwork
    if (!network) throw new Error('The node is not running')
    await shell.openExternal(`http://127.0.0.1:${NODE_API_PORT[network]}/panel`)
  })

  handle(IPC.openFolder, async (n) => {
    const dir = layout.netDir(ctx.root, asNetwork(n))
    await mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
  })
}
