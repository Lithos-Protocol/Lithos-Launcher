import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { renameWithRetry } from './util'

// Every hop of every download, redirects included, must stay on these hosts.
const ALLOWED_HOSTS = new Set([
  'api.adoptium.net',
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])
const MAX_REDIRECTS = 5
const STALL_TIMEOUT_MS = 60_000
const USER_AGENT = 'Lithos-Launcher'

function checkUrl(url: string): void {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`Refusing to download from ${u.origin}`)
  }
}

async function fetchChecked(url: string, accept: string, signal: AbortSignal): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkUrl(current)
    const res = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: accept }
    })
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel()
      const location = res.headers.get('location')
      if (!location) throw new Error(`Redirect without a location from ${new URL(current).host}`)
      current = new URL(location, current).toString()
      continue
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`HTTP ${res.status} from ${new URL(current).host}`)
    }
    return res
  }
  throw new Error('Too many redirects')
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetchChecked(url, 'application/json', AbortSignal.timeout(20_000))
  return (await res.json()) as T
}

export interface DownloadOptions {
  /** Expected SHA-256 (hex). The file is only moved into place if it matches. */
  sha256: string
  onProgress?: (received: number, total: number) => void
}

/** Streams `url` to `dest`, verifying SHA-256 before the file appears at `dest`. */
export async function download(url: string, dest: string, opts: DownloadOptions): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`

  // Abort if no bytes arrive for a while, rather than hanging forever.
  const stall = new AbortController()
  let stallTimer = setTimeout(() => stall.abort(new Error('Download stalled')), STALL_TIMEOUT_MS)
  const bump = (): void => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => stall.abort(new Error('Download stalled')), STALL_TIMEOUT_MS)
  }

  try {
    const res = await fetchChecked(url, 'application/octet-stream', stall.signal)
    if (!res.body) throw new Error('Empty response body')
    const total = Number(res.headers.get('content-length') ?? 0)
    const hash = createHash('sha256')
    let received = 0
    let lastReport = 0

    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bump()
        hash.update(chunk)
        received += chunk.length
        const now = Date.now()
        if (now - lastReport > 100) {
          lastReport = now
          opts.onProgress?.(received, total)
        }
        cb(null, chunk)
      }
    })

    await pipeline(Readable.fromWeb(res.body as NodeReadableStream), meter, createWriteStream(part))
    opts.onProgress?.(received, total)

    if (hash.digest('hex') !== opts.sha256.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${basename(dest)}. The download was corrupted or tampered with.`)
    }
    await renameWithRetry(part, dest)
  } catch (err) {
    await rm(part, { force: true })
    throw stall.signal.aborted ? stall.signal.reason : err
  } finally {
    clearTimeout(stallTimer)
  }
}
