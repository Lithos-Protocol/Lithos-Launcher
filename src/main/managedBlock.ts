import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './util'

// The launcher owns only the text between these markers in ergo.conf / lithos.conf.
// Settings placed below the block override it (later keys win in HOCON), so hand edits survive.
const BEGIN = '# >>> lithos-launcher (managed, edits here are overwritten)'
const END = '# <<< lithos-launcher'

async function readOrEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

function blockOf(text: string): string | null {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  return begin !== -1 && end > begin ? text.slice(begin, end) : null
}

/** Replaces the managed block in `file` with `lines`, or prepends one, leaving everything else untouched. */
export async function writeManagedBlock(file: string, lines: string[]): Promise<void> {
  const block = [BEGIN, ...lines, END].join('\n')
  const existing = await readOrEmpty(file)
  const begin = existing.indexOf(BEGIN)
  const end = existing.indexOf(END)
  const next =
    begin !== -1 && end > begin
      ? existing.slice(0, begin) + block + existing.slice(end + END.length)
      : existing.trim()
        ? `${block}\n\n${existing}`
        : `${block}\n`
  await writeFileAtomic(file, next)
}

/**
 * Reads a `key = number` line back from the managed block (the launcher writes these
 * one per line), so choices like ports survive when the block is regenerated.
 */
export async function readManagedNumber(file: string, key: string): Promise<number | null> {
  const block = blockOf(await readOrEmpty(file))
  if (!block) return null
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^\\s*${escaped}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(block)
  return match ? Number(match[1]) : null
}
