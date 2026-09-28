import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskProgress } from '@shared/types'
import { download, getJson } from './net'
import { compareVersions } from './util'

/** Oldest node with the API calls the Lithos Client needs (Lithos-Client/TestnetNode.md). */
const MIN_VERSION = '6.0.6'
const JAR_RE = /^ergo-(\d+\.\d+\.\d+)\.jar$/

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
  digest: string | null
}

interface GhRelease {
  draft: boolean
  prerelease: boolean
  assets: GhAsset[]
}

interface ErgoRelease {
  version: string
  name: string
  url: string
  sha256: string
  size: number
}

/** Newest stable Ergo release with a plain node jar, at or above MIN_VERSION. */
async function resolveErgo(): Promise<ErgoRelease> {
  const releases = await getJson<GhRelease[]>('https://api.github.com/repos/ergoplatform/ergo/releases?per_page=30')
  let best: { version: string; asset: GhAsset } | null = null
  for (const release of releases) {
    if (release.draft || release.prerelease) continue
    for (const asset of release.assets) {
      const version = JAR_RE.exec(asset.name)?.[1]
      if (!version || compareVersions(version, MIN_VERSION) < 0) continue
      if (!best || compareVersions(version, best.version) > 0) best = { version, asset }
    }
  }
  if (!best) throw new Error(`No Ergo node release ${MIN_VERSION} or newer was found`)

  const digest = best.asset.digest
  if (!digest?.startsWith('sha256:')) {
    throw new Error(`Ergo ${best.version} has no published checksum, so it will not be installed`)
  }
  return {
    version: best.version,
    name: best.asset.name,
    url: best.asset.browser_download_url,
    sha256: digest.slice('sha256:'.length),
    size: best.asset.size
  }
}

/** Highest-version node jar in `nodeDir`, or null. */
export async function detectErgo(nodeDir: string): Promise<{ version: string; jar: string } | null> {
  let files: string[]
  try {
    files = await readdir(nodeDir)
  } catch {
    return null
  }
  let best: { version: string; jar: string } | null = null
  for (const file of files) {
    const version = JAR_RE.exec(file)?.[1]
    if (version && (!best || compareVersions(version, best.version) > 0)) best = { version, jar: join(nodeDir, file) }
  }
  return best
}

export async function installErgo(nodeDir: string, onProgress: (p: TaskProgress) => void): Promise<string> {
  onProgress({ task: 'node', phase: 'resolving' })
  const release = await resolveErgo()
  await mkdir(nodeDir, { recursive: true })
  await download(release.url, join(nodeDir, release.name), {
    sha256: release.sha256,
    onProgress: (received, total) =>
      onProgress({ task: 'node', phase: 'downloading', received, total: total || release.size })
  })
  onProgress({ task: 'node', phase: 'done', message: release.version })
  return release.version
}
