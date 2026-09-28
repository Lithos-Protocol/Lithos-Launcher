import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import * as yauzl from 'yauzl'

/** Resolves an archive entry inside `destDir`, refusing anything that would escape it (zip-slip). */
function safeTarget(destDir: string, entryName: string): string {
  const root = resolve(destDir) + sep
  const target = resolve(destDir, entryName)
  if (!target.startsWith(root)) throw new Error(`Archive entry escapes the target folder: ${entryName}`)
  return target
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true })

  const handle = async (entry: yauzl.Entry): Promise<void> => {
    const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
    if (fileType === 0o120000) throw new Error(`Refusing symlink in archive: ${entry.fileName}`)

    const target = safeTarget(destDir, entry.fileName)
    if (entry.fileName.endsWith('/')) {
      await mkdir(target, { recursive: true })
      return
    }
    await mkdir(dirname(target), { recursive: true })
    const stream = await zip.openReadStreamPromise(entry)
    await pipeline(stream, createWriteStream(target))
  }

  try {
    await new Promise<void>((done, fail) => {
      zip.on('error', fail)
      zip.on('end', () => done())
      zip.on('entry', (entry: yauzl.Entry) => {
        handle(entry).then(() => zip.readEntry(), fail)
      })
      zip.readEntry()
    })
  } finally {
    if (zip.isOpen) zip.close()
  }
}

/** node-tar already strips absolute paths and `..` and refuses to write through symlinks. */
export async function extractTarGz(archive: string, destDir: string): Promise<void> {
  await tar.x({ file: archive, cwd: destDir, strict: true })
}
