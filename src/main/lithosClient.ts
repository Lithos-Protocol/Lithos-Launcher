import { access, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Network, TaskProgress } from '@shared/types'
import { extractZip } from './extract'
import { download, getJson } from './net'
import { compareVersions, renameWithRetry } from './util'

const RELEASES_URL = 'https://api.github.com/repos/Lithos-Protocol/Lithos-Client/releases?per_page=30'
const ZIP_RE = /^lithos-client-.+\.zip$/
const HOME_RE = /^lithos-client-(.+)$/

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
  digest: string | null
}

interface GhRelease {
  tag_name: string
  draft: boolean
  published_at: string
  assets: GhAsset[]
}

export interface InstalledClient {
  version: string
  /** The unpacked release (bin/, conf/, lib/). */
  home: string
  launcherJar: string
}

/** Testnet builds are tagged "-test"; every other release is the mainnet track. */
function onTrack(network: Network, tag: string): boolean {
  return tag.endsWith('-test') === (network === 'testnet')
}

/** Orders "5.6.0-test" / "1.1.0-prerelease" style versions by their numeric part. */
function compareLoose(a: string, b: string): number {
  const num = (v: string): string => /^\d+(?:\.\d+)*/.exec(v)?.[0] ?? '0'
  return compareVersions(num(a), num(b))
}

async function resolveClient(network: Network) {
  const releases = await getJson<GhRelease[]>(RELEASES_URL)
  const release = releases
    .filter((r) => !r.draft && onTrack(network, r.tag_name))
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .find((r) => r.assets.some((a) => ZIP_RE.test(a.name)))
  if (!release) throw new Error(`No Lithos Client release was found for ${network}`)

  const asset = release.assets.find((a) => ZIP_RE.test(a.name))!
  if (!asset.digest?.startsWith('sha256:')) {
    throw new Error(`Lithos Client ${release.tag_name} has no published checksum, so it will not be installed`)
  }
  return {
    version: release.tag_name.replace(/^v/, ''),
    name: asset.name,
    url: asset.browser_download_url,
    sha256: asset.digest.slice('sha256:'.length),
    size: asset.size
  }
}

async function launcherJarIn(home: string): Promise<string | null> {
  try {
    const jar = (await readdir(join(home, 'lib'))).find((f) => f.endsWith('-launcher.jar'))
    return jar ? join(home, 'lib', jar) : null
  } catch {
    return null
  }
}

/** Newest unpacked release in `clientDir`, or null. */
export async function detectClient(clientDir: string): Promise<InstalledClient | null> {
  let entries: string[]
  try {
    entries = await readdir(clientDir)
  } catch {
    return null
  }
  let best: InstalledClient | null = null
  for (const entry of entries) {
    const version = HOME_RE.exec(entry)?.[1]
    if (!version) continue
    const home = join(clientDir, entry)
    const launcherJar = await launcherJarIn(home)
    if (launcherJar && (!best || compareLoose(version, best.version) > 0)) best = { version, home, launcherJar }
  }
  return best
}

export async function installClient(
  clientDir: string,
  network: Network,
  onProgress: (p: TaskProgress) => void
): Promise<string> {
  onProgress({ task: 'client', phase: 'resolving' })
  const release = await resolveClient(network)

  const archive = join(clientDir, '.downloads', release.name)
  const staging = join(clientDir, `.staging-${Date.now()}`)
  const target = join(clientDir, `lithos-client-${release.version}`)
  try {
    await download(release.url, archive, {
      sha256: release.sha256,
      onProgress: (received, total) =>
        onProgress({ task: 'client', phase: 'downloading', received, total: total || release.size })
    })

    onProgress({ task: 'client', phase: 'extracting' })
    await mkdir(staging, { recursive: true })
    await extractZip(archive, staging)

    // Release zips hold a single lithos-client/ folder.
    const top = await readdir(staging)
    if (top.length !== 1 || !(await stat(join(staging, top[0]))).isDirectory()) {
      throw new Error('Unexpected Lithos Client archive layout')
    }
    if (!(await launcherJarIn(join(staging, top[0])))) throw new Error('The Lithos Client archive has no launcher jar')
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await renameWithRetry(join(staging, top[0]), target)
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await rm(join(clientDir, '.downloads'), { recursive: true, force: true })
  }

  onProgress({ task: 'client', phase: 'done', message: release.version })
  return release.version
}

/** The node wallet's keystore file (one UUID-named JSON), or null before a wallet exists. */
export async function findKeystore(keystoreDir: string): Promise<string | null> {
  let files: string[]
  try {
    files = (await readdir(keystoreDir)).filter((f) => f.endsWith('.json'))
  } catch {
    return null
  }
  let newest: { path: string; mtime: number } | null = null
  for (const file of files) {
    const path = join(keystoreDir, file)
    try {
      await access(path)
      const mtime = (await stat(path)).mtimeMs
      if (!newest || mtime > newest.mtime) newest = { path, mtime }
    } catch {
      // vanished while listing
    }
  }
  return newest?.path ?? null
}
