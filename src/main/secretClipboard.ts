import { spawn } from 'node:child_process'
import { app, clipboard } from 'electron'
import { powershellPath } from './interrupt'

const CLEAR_AFTER_MS = 30_000

// Windows keeps a clipboard history (Win+V) and can sync it to the user's other devices. Content
// carrying these formats is left out of both, as it is for password managers. The value is read
// from stdin, so it never appears on a command line.
const PROTECTED_COPY_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$text = [Console]::In.ReadLine()
$data = New-Object System.Windows.Forms.DataObject
$data.SetText($text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
$data.SetData('ExcludeClipboardContentFromMonitorProcessing', (New-Object System.IO.MemoryStream(,[byte[]](0))))
$data.SetData('CanIncludeInClipboardHistory', (New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0))))
$data.SetData('CanUploadToCloudClipboard', (New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0))))
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 5, 100)
exit 0
`

function protectedCopyWindows(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const helper = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-Sta', '-Command', PROTECTED_COPY_SCRIPT], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true
    })
    const timer = setTimeout(() => {
      helper.kill()
      resolve(false)
    }, 20_000)
    helper.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    helper.once('close', async (code) => {
      clearTimeout(timer)
      resolve(code === 0 && (await clipboard.readText()) === text)
    })
    helper.stdin.end(`${text}\n`)
  })
}

let pending: { text: string; timer: NodeJS.Timeout } | null = null

/** Clears the clipboard if it still holds the secret, so nothing the user copied since is lost. */
async function clearIfStillThere(): Promise<void> {
  const current = pending
  if (!current) return
  pending = null
  clearTimeout(current.timer)
  if ((await clipboard.readText()) === current.text) clipboard.clear()
}

app.on('will-quit', () => void clearIfStillThere())

/**
 * Puts a secret on the clipboard from the main process (the renderer never sees it), kept out of
 * Windows clipboard history where possible, and clears it again after 30 seconds.
 */
export async function copySecret(text: string): Promise<void> {
  await clearIfStillThere()
  const copied = process.platform === 'win32' && (await protectedCopyWindows(text))
  if (!copied) await clipboard.writeText(text)
  pending = { text, timer: setTimeout(() => void clearIfStillThere(), CLEAR_AFTER_MS) }
}
