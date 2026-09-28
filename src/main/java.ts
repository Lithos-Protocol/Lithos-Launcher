import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskProgress } from '@shared/types'
import { extractTarGz, extractZip } from './extract'
import { layout } from './layout'
import { download, getJson } from './net'
import { renameWithRetry } from './util'

interface AdoptiumAsset {
  binary: { package: { name: string; link: string; checksum: string; size: number } }
  version: { openjdk_version: string }
}

interface JreRelease {
  version: string
  name: string
  url: string
  sha256: string
  size: number
}

/** Latest Temurin 11 JRE for this OS/arch from the Adoptium API. */
async function resolveJre(): Promise<JreRelease> {
  const os = process.platform === 'win32' ? 'windows' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const url =
    'https://api.adoptium.net/v3/assets/latest/11/hotspot' +
    `?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`
  const [asset] = await getJson<AdoptiumAsset[]>(url)
  if (!asset) throw new Error(`No Java 11 runtime published for ${os}/${arch}`)
  const pkg = asset.binary.package
  return { version: asset.version.openjdk_version, name: pkg.name, url: pkg.link, sha256: pkg.checksum, size: pkg.size }
}

/** Installed JRE version, or null if none. */
export async function detectJre(root: string): Promise<string | null> {
  try {
    await access(layout.javaBin(root))
  } catch {
    return null
  }
  try {
    const release = await readFile(join(layout.javaDir(root), 'release'), 'utf8')
    return /^JAVA_VERSION="([^"]+)"/m.exec(release)?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function installJre(root: string, onProgress: (p: TaskProgress) => void): Promise<string> {
  onProgress({ task: 'java', phase: 'resolving' })
  const jre = await resolveJre()

  const javaRoot = join(root, 'java')
  const archive = join(javaRoot, '.downloads', jre.name)
  const staging = join(javaRoot, `.staging-${Date.now()}`)

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
    const target = layout.javaDir(root)
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await renameWithRetry(join(staging, top[0]), target)
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await rm(join(javaRoot, '.downloads'), { recursive: true, force: true })
  }

  const version = await detectJre(root)
  if (!version) throw new Error('Java was extracted but the java binary is missing')
  onProgress({ task: 'java', phase: 'done', message: version })
  return version
}
