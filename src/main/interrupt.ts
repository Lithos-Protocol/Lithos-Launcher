import { spawn } from 'node:child_process'
import { join } from 'node:path'

// Windows has no signals, and Node's process.kill() there is always a hard TerminateProcess.
// The JVM does honour a console Ctrl+C event, though, exactly as if Ctrl+C were pressed in a
// terminal: it runs its shutdown hooks (Akka CoordinatedShutdown). To raise one, a helper
// detaches from its own console, attaches to the target's hidden console, ignores Ctrl+C
// itself, and generates CTRL_C_EVENT for everything on that console.
//
// Caveat: a process that inherited "ignore Ctrl+C" (e.g. from a parent started with
// CREATE_NEW_PROCESS_GROUP) silently ignores this, so callers keep a timed hard-kill fallback.
const CTRL_C_SCRIPT = (pid: number): string => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class LithosConsoleCtrl {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroup);
}
"@
[LithosConsoleCtrl]::FreeConsole() | Out-Null
if (-not [LithosConsoleCtrl]::AttachConsole(${pid})) { exit 2 }
[LithosConsoleCtrl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [LithosConsoleCtrl]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
exit 0
`

export function powershellPath(): string {
  // Absolute path so a stray powershell.exe earlier on PATH is never picked up.
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Asks a process to shut down the way Ctrl+C would: SIGTERM on Linux, a console
 * Ctrl+C event on Windows. Resolves true if the request was delivered.
 */
export function interrupt(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false)
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGTERM')
      return Promise.resolve(true)
    } catch {
      return Promise.resolve(false)
    }
  }
  return new Promise((resolve) => {
    const helper = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', CTRL_C_SCRIPT(pid)], {
      stdio: 'ignore',
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
    helper.once('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}
