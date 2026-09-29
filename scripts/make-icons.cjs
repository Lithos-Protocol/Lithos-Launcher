// Renders the app and tray icons from the brand cube SVG using Electron itself (no image tooling).
// Run: npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'assets', 'cube.svg'), 'utf8')
const SIZE = 512
const outputs = [
  { file: path.join(root, 'build', 'icon.png'), size: 512 },
  { file: path.join(root, 'resources', 'icon.png'), size: 256 },
  { file: path.join(root, 'resources', 'tray.png'), size: 32 },
  { file: path.join(root, 'resources', 'tray@2x.png'), size: 64 }
]

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      transparent: true,
      frame: false,
      useContentSize: true,
      webPreferences: { offscreen: true }
    })
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${SIZE}" height="${SIZE}"></body></html>`
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    await new Promise((r) => setTimeout(r, 300))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
    for (const { file, size } of outputs) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, image.resize({ width: size, height: size, quality: 'best' }).toPNG())
      console.log(`${path.relative(root, file)} ${size}x${size}`)
    }
    win.destroy()
  })
  .catch((err) => console.error(err))
  .finally(() => app.quit())
