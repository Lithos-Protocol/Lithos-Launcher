import type { Dirent } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ergoDb, type ErgoDb, type TaskProgress } from '@shared/types'
import { download, getJson } from './net'
import { compareVersions } from './util'

/** Oldest node with the API calls the Lithos Client needs (Lithos-Client/TestnetNode.md). */
const MIN_VERSION = '6.0.6'
const JAR_RE = /^ergo-(\d+\.\d+\.\d+)\.jar$/

/** A RocksDB build is its LevelDB twin with minor 1 (6.1.6 is 6.0.6), so both meet the minimum together. */
function meetsMinimum(version: string): boolean {
  const [major, , patch] = version.split('.')
  const twin = ergoDb(version) === 'rocksdb' ? `${major}.0.${patch}` : version
  return compareVersions(twin, MIN_VERSION) >= 0
}

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
  digest: string | null
}

interface GhRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string
  assets: GhAsset[]
}

export interface ErgoRelease {
  version: string
  name: string
  url: string
  sha256: string
  size: number
  publishedAt: string
  /** GitHub's pre-release flag. Ergo sets it on every RocksDB (x.1.y) build, so it isn't a warning. */
  prerelease: boolean
}

/**
 * Every Ergo release the launcher can install, newest first: a plain node jar at or above
 * MIN_VERSION (or its RocksDB twin) with a published checksum, since without one the download
 * can't be verified. Release candidates are left out.
 */
export async function listErgoReleases(): Promise<ErgoRelease[]> {
  const releases = await getJson<GhRelease[]>('https://api.github.com/repos/ergoplatform/ergo/releases?per_page=50')
  const found = new Map<string, ErgoRelease>()
  for (const release of releases) {
    if (release.draft || /rc\d*$/i.test(release.tag_name)) continue
    for (const asset of release.assets) {
      const version = JAR_RE.exec(asset.name)?.[1]
      if (!version || !meetsMinimum(version) || found.has(version)) continue
      if (!asset.digest?.startsWith('sha256:')) continue
      found.set(version, {
        version,
        name: asset.name,
        url: asset.browser_download_url,
        sha256: asset.digest.slice('sha256:'.length),
        size: asset.size,
        publishedAt: release.published_at,
        prerelease: release.prerelease
      })
    }
  }
  return [...found.values()].sort((a, b) => compareVersions(b.version, a.version))
}

/** Same database, or for a line whose database isn't known, the same major.minor. */
export function sameErgoLine(a: string, b: string): boolean {
  const [da, db] = [ergoDb(a), ergoDb(b)]
  if (da && db) return da === db
  return a.split('.').slice(0, 2).join('.') === b.split('.').slice(0, 2).join('.')
}

/**
 * What a fresh install gets: the newest release for the database existing chain data uses, else
 * the newest one Ergo marks stable (its own advice is to use 6.0.x unless you know you want 6.1.x).
 */
export function defaultErgo(releases: ErgoRelease[], dataDb: ErgoDb | null): ErgoRelease | null {
  if (dataDb) return releases.find((r) => ergoDb(r.version) === dataDb) ?? null
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null
}

/** The newest release that updates `active` in place, or null. */
export function ergoUpdate(releases: ErgoRelease[], active: string): string | null {
  const next = releases.find((r) => sameErgoLine(r.version, active) && compareVersions(r.version, active) > 0)
  return next?.version ?? null
}

/**
 * The database the chain data in `dataDir` was written with, or null if there is none yet.
 * Any folder holding a CURRENT file is a database; RocksDB also writes IDENTITY and OPTIONS-*
 * files there. (Table extensions don't tell them apart: Ergo's Java LevelDB fallback writes
 * .sst tables, as RocksDB does.)
 */
export async function chainDb(dataDir: string): Promise<ErgoDb | null> {
  let dirs = [join(dataDir, 'history'), join(dataDir, 'state')]
  for (let depth = 0; depth < 3 && dirs.length; depth++) {
    const next: string[] = []
    for (const dir of dirs) {
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      const names = entries.filter((e) => e.isFile()).map((e) => e.name)
      if (names.includes('CURRENT')) {
        return names.some((n) => n === 'IDENTITY' || n.startsWith('OPTIONS-')) ? 'rocksdb' : 'leveldb'
      }
      for (const e of entries) if (e.isDirectory()) next.push(join(dir, e.name))
    }
    dirs = next
  }
  return null
}

/** Node jars in `nodeDir`, newest first. */
export async function installedErgo(nodeDir: string): Promise<{ version: string; jar: string }[]> {
  let files: string[]
  try {
    files = await readdir(nodeDir)
  } catch {
    return []
  }
  return files
    .flatMap((file) => {
      const version = JAR_RE.exec(file)?.[1]
      return version ? [{ version, jar: join(nodeDir, file) }] : []
    })
    .sort((a, b) => compareVersions(b.version, a.version))
}

/** The node jar to run: the version picked under Versions if it is installed, else the newest. */
export async function detectErgo(
  nodeDir: string,
  pinned: string | null = null
): Promise<{ version: string; jar: string } | null> {
  const installed = await installedErgo(nodeDir)
  return installed.find((i) => i.version === pinned) ?? installed[0] ?? null
}

export async function installErgo(
  nodeDir: string,
  release: ErgoRelease,
  onProgress: (p: TaskProgress) => void
): Promise<string> {
  await mkdir(nodeDir, { recursive: true })
  await download(release.url, join(nodeDir, release.name), {
    sha256: release.sha256,
    onProgress: (received, total) =>
      onProgress({ task: 'node', phase: 'downloading', received, total: total || release.size })
  })
  onProgress({ task: 'node', phase: 'done', message: release.version })
  return release.version
}

/** Deletes every node jar but `keep`. A jar still in use is left for next time. */
export async function removeOtherErgo(nodeDir: string, keep: string): Promise<void> {
  for (const { version, jar } of await installedErgo(nodeDir)) {
    if (version !== keep) await rm(jar, { force: true }).catch(() => undefined)
  }
}
