// Renders the app and tray icons from the Lithos mark (the web docs' logo) using Electron itself
// (no image tooling). Run: npm run icons
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const mark = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'assets', 'lithos-mark.png'))
const SIZE = 512
// App icons get a little room around the mark, like other desktop icons; the tiny tray icon
// uses the full square so the pickaxe stays readable at 16 px.
const outputs = [
  { file: path.join(root, 'build', 'icon.png'), size: 512, pad: 0.06 },
  { file: path.join(root, 'resources', 'icon.png'), size: 256, pad: 0.06 },
  { file: path.join(root, 'resources', 'tray.png'), size: 32, pad: 0 },
  { file: path.join(root, 'resources', 'tray@2x.png'), size: 64, pad: 0 }
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
    const render = async (pad) => {
      const inset = Math.round(SIZE * pad)
      const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
        <img src="data:image/png;base64,${mark.toString('base64')}"
          style="display:block;margin:${inset}px;width:${SIZE - 2 * inset}px;height:${SIZE - 2 * inset}px"></body></html>`
      await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
      await new Promise((r) => setTimeout(r, 300))
      return win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
    }
    const images = new Map()
    for (const { file, size, pad } of outputs) {
      if (!images.has(pad)) images.set(pad, await render(pad))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, images.get(pad).resize({ width: size, height: size, quality: 'best' }).toPNG())
      console.log(`${path.relative(root, file)} ${size}x${size}`)
    }
    win.destroy()
  })
  .catch((err) => console.error(err))
  .finally(() => app.quit())
