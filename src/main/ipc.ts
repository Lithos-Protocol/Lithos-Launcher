import { mkdir } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { clipboard, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC, isNetwork, type AppInfo, type Network, type ProcId } from '@shared/types'
import type { ClientController } from './clientController'
import type { Installer } from './installer'
import { layout, NODE_API_PORT } from './layout'
import type { NodeController } from './nodeController'
import type { Vault } from './vault'
import type { WalletManager } from './wallet'

interface IpcContext {
  window: () => BrowserWindow | null
  root: string
  vault: Vault
  installer: Installer
  node: NodeController
  wallet: WalletManager
  client: ClientController
  skipSyncGate: boolean
}

function asNetwork(value: unknown): Network {
  if (!isNetwork(value)) throw new Error('Invalid network')
  return value
}

function asProcId(value: unknown): ProcId {
  if (value !== 'node' && value !== 'client') throw new Error('Invalid process id')
  return value
}

function asString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('Invalid argument')
  return value
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid argument')
  return value
}

/** Non-internal IPv4 addresses, for pointing rigs on the LAN at the stratum port. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a!.address)
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
  const procOf = (id: ProcId) => (id === 'node' ? ctx.node.proc : ctx.client.proc)

  handle(IPC.getState, (n) => ctx.installer.state(asNetwork(n)))
  handle(
    IPC.getAppInfo,
    (): AppInfo => ({ vault: ctx.vault.info, skipSyncGate: ctx.skipSyncGate, lanAddresses: lanAddresses() })
  )
  handle(IPC.install, (n) => ctx.installer.install(asNetwork(n)))
  handle(IPC.startNode, (n) => ctx.node.start(asNetwork(n)))
  // The client depends on the node, so it always stops first.
  handle(IPC.stopNode, async () => {
    await ctx.client.stop()
    await ctx.node.stop()
  })
  handle(IPC.getProc, (id) => procOf(asProcId(id)).state)
  handle(IPC.getLogs, (id) => procOf(asProcId(id)).snapshot())
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

  handle(IPC.startClient, (n) => ctx.client.start(asNetwork(n)))
  handle(IPC.stopClient, () => ctx.client.stop())
  handle(IPC.openLithosPanel, async () => {
    const port = ctx.client.httpPort
    if (port === null) throw new Error('The Lithos Client is not running')
    await shell.openExternal(`http://127.0.0.1:${port}/`)
  })

  handle(IPC.getWallet, () => ctx.wallet.state)
  handle(IPC.createWallet, (password) => ctx.wallet.create(asString(password, 256)))
  handle(IPC.restoreWallet, (mnemonic, password) =>
    ctx.wallet.restore(asString(mnemonic, 1000), asString(password, 256))
  )
  handle(IPC.unlockWallet, (password, remember) => ctx.wallet.unlock(asString(password, 256), asBoolean(remember)))

  // The renderer has no clipboard permission; copying goes through here.
  handle(IPC.copyText, (text) => clipboard.writeText(asString(text, 2000)))
  handle(IPC.setSensitive, (on) => ctx.window()?.setContentProtection(asBoolean(on)))
}
