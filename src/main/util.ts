import { rename, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Compares dotted numeric versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Windows antivirus scanners briefly lock freshly written files, which makes
 * renames fail with EPERM/EBUSY. Retry for a few seconds before giving up.
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await sleep(250)
    }
  }
}

export async function writeFileAtomic(file: string, data: string | Buffer, mode = 0o644): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, data, { mode })
  await renameWithRetry(tmp, file)
}

/** True if something is already accepting connections on 127.0.0.1:port. */
export function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (open: boolean): void => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(1000, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}
