import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Network, TaskProgress } from '@shared/types'
import { clientRetired, compareLoose } from '@shared/versions'
import { extractZip } from './extract'
import { download, getJson } from './net'
import { renameWithRetry } from './util'

const RELEASES_URL = 'https://api.github.com/repos/Lithos-Protocol/Lithos-Client/releases?per_page=50'
const ZIP_RE = /^lithos-client-.+\.zip$/
const HOME_RE = /^lithos-client-(.+)$/
/** Releases being removed are renamed to this first. */
const OLD_PREFIX = '.old-'

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

export interface ClientRelease {
  version: string
  name: string
  url: string
  sha256: string
  size: number
  publishedAt: string
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

/**
 * Every release on this network's track with a client zip and a published checksum (without one
 * the download can't be verified), newest first. Retired releases are left out.
 */
export async function listClientReleases(network: Network): Promise<ClientRelease[]> {
  const releases = await getJson<GhRelease[]>(RELEASES_URL)
  return releases
    .filter((r) => !r.draft && onTrack(network, r.tag_name) && !clientRetired(r.tag_name.replace(/^v/, '')))
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .flatMap((release) => {
      const asset = release.assets.find((a) => ZIP_RE.test(a.name))
      if (!asset?.digest?.startsWith('sha256:')) return []
      return [
        {
          version: release.tag_name.replace(/^v/, ''),
          name: asset.name,
          url: asset.browser_download_url,
          sha256: asset.digest.slice('sha256:'.length),
          size: asset.size,
          publishedAt: release.published_at
        }
      ]
    })
}

/** The newest release if it came out after `active`, else null. */
export function clientUpdate(releases: ClientRelease[], active: string): string | null {
  const newest = releases[0]
  if (!newest || newest.version === active) return null
  const at = releases.findIndex((r) => r.version === active)
  // A version no longer listed (pulled, or past the first page) is compared by number.
  return at > 0 || (at === -1 && compareLoose(newest.version, active) > 0) ? newest.version : null
}

async function launcherJarIn(home: string): Promise<string | null> {
  try {
    const jar = (await readdir(join(home, 'lib'))).find((f) => f.endsWith('-launcher.jar'))
    return jar ? join(home, 'lib', jar) : null
  } catch {
    return null
  }
}

/** Unpacked releases in `clientDir`, newest first. */
export async function installedClients(clientDir: string): Promise<InstalledClient[]> {
  let entries: string[]
  try {
    entries = await readdir(clientDir)
  } catch {
    return []
  }
  const found: InstalledClient[] = []
  for (const entry of entries) {
    const version = HOME_RE.exec(entry)?.[1]
    if (!version) continue
    const home = join(clientDir, entry)
    const launcherJar = await launcherJarIn(home)
    if (launcherJar) found.push({ version, home, launcherJar })
  }
  return found.sort((a, b) => compareLoose(b.version, a.version))
}

/** The release to run: the version picked under Versions if it is installed, else the newest one not retired, else the newest. */
export async function detectClient(clientDir: string, pinned: string | null = null): Promise<InstalledClient | null> {
  const installed = await installedClients(clientDir)
  return (
    installed.find((c) => c.version === pinned) ??
    installed.find((c) => !clientRetired(c.version)) ??
    installed[0] ??
    null
  )
}

export async function installClient(
  clientDir: string,
  release: ClientRelease,
  onProgress: (p: TaskProgress) => void
): Promise<string> {
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

/**
 * Deletes every unpacked release but `keep`. Only the release folders go: lithos.conf, .lithos/
 * and logs/ sit beside them and stay. A release still in use is left for next time.
 */
export async function removeOtherClients(clientDir: string, keep: string): Promise<void> {
  const drop = (path: string): Promise<void> =>
    rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined)
  // Leftovers from an earlier removal that didn't finish.
  for (const entry of await readdir(clientDir).catch(() => [])) {
    if (entry.startsWith(OLD_PREFIX)) await drop(join(clientDir, entry))
  }
  for (const { version, home } of await installedClients(clientDir)) {
    if (version === keep) continue
    // Moved aside first: Windows won't rename a release that is still running, so one in use is
    // skipped whole instead of being left half deleted.
    const aside = join(clientDir, `${OLD_PREFIX}${basename(home)}`)
    try {
      await rename(home, aside)
    } catch {
      continue
    }
    await drop(aside)
  }
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
