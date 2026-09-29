import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeTheme, session } from 'electron'
import { IPC } from '@shared/types'
import { ClientController } from './clientController'
import { Importer } from './importer'
import { Installer } from './installer'
import { registerIpc } from './ipc'
import { installRoot } from './layout'
import { NodeController } from './nodeController'
import { loadSettings } from './settings'
import { LauncherTray } from './tray'
import { Vault } from './vault'
import { WalletManager } from './wallet'

app.enableSandbox()
// The UI is simple enough to draw in software. Staying off the GPU keeps the launcher out of the
// miner's way (VRAM, driver time) and drops the GPU process's memory.
app.disableHardwareAcceleration()

// Dev/testing: a custom install root gets its own launcher profile (vault, caches, instance lock).
if (!app.isPackaged && process.env.LITHOS_LAUNCHER_ROOT) {
  app.setPath('userData', join(installRoot(), '.launcher-profile'))
}

// launcher.json (install folder, heap overrides, adopted data folders) is read before anything else.
loadSettings()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

/** The user already chose "Close anyway" for an unconfirmed seed phrase; don't ask twice. */
let seedCloseConfirmed = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Lithos Launcher',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    backgroundColor: '#0a0f1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  win.once('ready-to-show', () => win.show())

  // The renderer blocks unloading while an unconfirmed seed phrase is on screen.
  win.webContents.on('will-prevent-unload', (event) => {
    if (seedCloseConfirmed) {
      event.preventDefault()
      return
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Stay', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Seed phrase not confirmed',
      message: 'You have not confirmed your seed phrase yet.',
      detail: 'If you close now, the launcher cannot show these words again. Without them, funds in this wallet cannot be recovered.'
    })
    if (choice === 1) event.preventDefault() // proceed with closing
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function main(): void {
  let win: BrowserWindow | null = null
  let quitting = false
  /** The window was closed but the node/client keep running from the tray. */
  let backgrounded = false
  /** An unconfirmed seed phrase is on screen (the renderer reports this). */
  let seedOnScreen = false
  let openWindow: () => void = () => {}

  app.on('second-instance', () => openWindow())

  // No navigation, popups or webviews: the UI is one local page.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  app.on('window-all-closed', () => {
    if (!backgrounded) app.quit()
  })

  void app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark'
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    if (app.isPackaged) Menu.setApplicationMenu(null)

    const root = installRoot()
    const vault = new Vault()
    await vault.load()

    const send = (channel: string, payload: unknown): void => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
    const installer = new Installer(root, vault, (p) => send(IPC.progress, p))
    const node = new NodeController(root, vault, (info) => send(IPC.nodeInfo, info))
    node.proc.on('state', (s) => send(IPC.procState, s))
    node.proc.on('logs', (chunk) => send(IPC.logs, chunk))
    const wallet = new WalletManager(node, vault)
    wallet.on('state', (s) => send(IPC.wallet, s))
    const skipSyncGate = !app.isPackaged && process.env.LITHOS_LAUNCHER_SKIP_SYNC_GATE === '1'
    const client = new ClientController(root, vault, node, wallet, skipSyncGate, (s) => send(IPC.clientStats, s))
    client.proc.on('state', (s) => send(IPC.procState, s))
    client.proc.on('logs', (chunk) => send(IPC.logs, chunk))

    const importer = new Importer(root)
    registerIpc({
      window: () => win,
      root,
      vault,
      installer,
      node,
      wallet,
      client,
      importer,
      skipSyncGate,
      onSensitive: (on) => (seedOnScreen = on)
    })

    const tray = new LauncherTray({
      open: () => openWindow(),
      quit: () => app.quit(),
      states: () => ({ node: node.proc.state, client: client.proc.state })
    })
    node.proc.on('state', () => tray.refresh())
    client.proc.on('state', () => tray.refresh())

    /**
     * Closing the window while the node or client runs asks whether to keep mining in the
     * background. Backgrounding destroys the window (and its renderer's memory); the tray reopens it.
     */
    const attachClose = (w: BrowserWindow): void => {
      w.on('close', (event) => {
        if (quitting || (!node.proc.alive && !client.proc.alive)) return
        event.preventDefault()
        if (seedOnScreen) {
          const stay = dialog.showMessageBoxSync(w, {
            type: 'warning',
            buttons: ['Stay', 'Close anyway'],
            defaultId: 0,
            cancelId: 0,
            title: 'Seed phrase not confirmed',
            message: 'You have not confirmed your seed phrase yet.',
            detail: 'If you close now, the launcher cannot show these words again.'
          })
          if (stay === 0) return
          seedCloseConfirmed = true
        }
        const running = client.proc.alive ? 'The node and the Lithos Client are' : 'The node is'
        const choice = dialog.showMessageBoxSync(w, {
          type: 'question',
          buttons: ['Keep running in the background', 'Stop and quit', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          title: 'Lithos is still running',
          message: `${running} still running.`,
          detail:
            'Keep mining in the background (the launcher stays in the system tray), or stop everything safely and quit.'
        })
        if (choice === 0) {
          backgrounded = true
          tray.show()
          w.destroy()
        } else if (choice === 1) {
          app.quit()
        }
      })
      w.on('closed', () => {
        if (win === w) win = null
      })
    }

    openWindow = () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        return
      }
      backgrounded = false
      win = createWindow()
      attachClose(win)
    }
    openWindow()

    // Never leave processes running unattended: stop the client, then the node, cleanly before exiting.
    app.on('before-quit', (event) => {
      if (quitting || (!node.proc.alive && !client.proc.alive)) return
      event.preventDefault()
      quitting = true
      void client
        .stop()
        .then(() => node.stop())
        .finally(() => app.quit())
    })
  })
}
