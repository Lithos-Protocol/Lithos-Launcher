import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { JavaRelease, TaskProgress } from '@shared/types'
import { compareJava, MIN_JAVA_MAJOR } from '@shared/versions'
import { extractTarGz, extractZip } from './extract'
import { layout } from './layout'
import { download, getJson } from './net'
import { renameWithRetry } from './util'

const API = 'https://api.adoptium.net/v3'

/** Offered when Adoptium's list of LTS lines can't be read. */
const FALLBACK_MAJORS = [11, 17, 21, 25]

interface AdoptiumAsset {
  binary: { package: { name: string; link: string; checksum: string; size: number }; updated_at: string }
  version: { openjdk_version: string; semver?: string }
}

/** A Temurin JRE build the launcher can install. */
export interface JreBuild extends JavaRelease {
  name: string
  url: string
  sha256: string
}

const platform = (): { os: string; arch: string } => ({
  os: process.platform === 'win32' ? 'windows' : 'linux',
  arch: process.arch === 'arm64' ? 'aarch64' : 'x64'
})

/** Newest Temurin JRE of one Java major for this OS/arch, or null if none is published. */
async function resolveJre(major: number): Promise<JreBuild | null> {
  const { os, arch } = platform()
  const url = `${API}/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`
  const [asset] = await getJson<AdoptiumAsset[]>(url)
  if (!asset) return null
  const pkg = asset.binary.package
  return {
    major,
    version: asset.version.openjdk_version,
    publishedAt: asset.binary.updated_at,
    size: pkg.size,
    name: pkg.name,
    url: pkg.link,
    sha256: pkg.checksum
  }
}

/** The newest build of each LTS Java line from 11 on, oldest major first. */
export async function listJreBuilds(): Promise<JreBuild[]> {
  let majors = FALLBACK_MAJORS
  try {
    const info = await getJson<{ available_lts_releases?: number[] }>(`${API}/info/available_releases`)
    const lts = (info.available_lts_releases ?? []).filter((m) => Number.isInteger(m) && m >= MIN_JAVA_MAJOR)
    if (lts.length > 0) majors = lts
  } catch {
    // The per-major lookups below still say whether Adoptium can be reached.
  }
  const builds = await Promise.all([...new Set(majors)].sort((a, b) => a - b).map(resolveJre))
  return builds.filter((b): b is JreBuild => b !== null)
}

/** Installed runtime version of a Java major ("11.0.33+10"), or null if it isn't installed. */
export async function detectJre(root: string, major?: number): Promise<string | null> {
  try {
    await access(layout.javaBin(root, major))
  } catch {
    return null
  }
  try {
    const release = await readFile(join(layout.javaDir(root, major), 'release'), 'utf8')
    const field = (key: string): string | undefined => new RegExp(`^${key}="([^"]+)"`, 'm').exec(release)?.[1]
    return field('JAVA_RUNTIME_VERSION') ?? field('JAVA_VERSION') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** A newer build of the installed runtime, or null when it is current (or its version is unknown). */
export function jreUpdate(installed: string | null, latest: JreBuild | undefined): string | null {
  if (!installed || installed === 'unknown' || !latest) return null
  return compareJava(latest.version, installed) > 0 ? latest.version : null
}

/**
 * Downloads and unpacks `jre` into its major's folder, replacing a build already there.
 * `beforeSwap` runs once the new build is unpacked and checked, right before files in use change.
 */
export async function installJre(
  root: string,
  jre: JreBuild,
  onProgress: (p: TaskProgress) => void,
  beforeSwap: () => Promise<void> = async () => {}
): Promise<string> {
  const javaRoot = join(root, 'java')
  const stamp = Date.now()
  const archive = join(javaRoot, '.downloads', jre.name)
  const staging = join(javaRoot, `.staging-${stamp}`)
  const old = join(javaRoot, `.old-${stamp}`)
  const target = layout.javaDir(root, jre.major)

  try {
    await download(jre.url, archive, {
      sha256: jre.sha256,
      onProgress: (received, total) =>
        onProgress({ task: 'java', phase: 'downloading', received, total: total || jre.size })
    })

    onProgress({ task: 'java', phase: 'extracting' })
    await mkdir(staging, { recursive: true })
    if (jre.name.endsWith('.zip')) await extractZip(archive, staging)
    else await extractTarGz(archive, staging)

    // Adoptium archives contain a single top-level folder, e.g. jdk-11.0.x+y-jre/
    const top = await readdir(staging)
    if (top.length !== 1) throw new Error('Unexpected Java archive layout')

    await beforeSwap()
    // The old build moves aside first, so a failed swap can put it back.
    const hadOld = await access(target).then(
      () => true,
      () => false
    )
    if (hadOld) await renameWithRetry(target, old)
    try {
      await renameWithRetry(join(staging, top[0]), target)
    } catch (err) {
      if (hadOld) await renameWithRetry(old, target).catch(() => undefined)
      throw err
    }
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await rm(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
    await rm(join(javaRoot, '.downloads'), { recursive: true, force: true })
  }

  const version = await detectJre(root, jre.major)
  if (!version) throw new Error('Java was extracted but the java binary is missing')
  onProgress({ task: 'java', phase: 'done', message: version })
  return version
}

/** Removes every Java major but `keep`. Folders still in use are left for next time. */
export async function removeOtherJres(root: string, keep: number): Promise<void> {
  const javaRoot = join(root, 'java')
  const entries = await readdir(javaRoot).catch(() => [] as string[])
  const keepName = `temurin-${keep}-jre`
  await Promise.all(
    entries
      .filter((name) => /^temurin-\d+-jre$/.test(name) && name !== keepName)
      .map((name) => rm(join(javaRoot, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined))
  )
}
