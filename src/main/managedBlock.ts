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

function span(text: string): { begin: number; end: number } | null {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  return begin !== -1 && end > begin ? { begin, end } : null
}

const keyPattern = (key: string): RegExp =>
  new RegExp(`^[ \\t]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, 'm')

/** Replaces the managed block in `file` with `lines`, or prepends one, leaving everything else untouched. */
export async function writeManagedBlock(file: string, lines: string[]): Promise<void> {
  const block = [BEGIN, ...lines, END].join('\n')
  const existing = await readOrEmpty(file)
  const at = span(existing)
  const next = at
    ? existing.slice(0, at.begin) + block + existing.slice(at.end + END.length)
    : existing.trim()
      ? `${block}\n\n${existing}`
      : `${block}\n`
  await writeFileAtomic(file, next)
}

/**
 * The raw value of a top-level `key = value` line in the managed block (the launcher writes its
 * settings one per line), so choices survive when the block is regenerated.
 */
export async function readManagedValue(file: string, key: string): Promise<string | null> {
  const text = await readOrEmpty(file)
  const at = span(text)
  if (!at) return null
  return keyPattern(key).exec(text.slice(at.begin, at.end))?.[1] ?? null
}

export async function readManagedNumber(file: string, key: string): Promise<number | null> {
  const raw = await readManagedValue(file, key)
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
}

/** Sets `key = value` lines inside the managed block (creating the block if needed); values are raw HOCON. */
export async function updateManagedLines(file: string, entries: Record<string, string>): Promise<void> {
  const text = await readOrEmpty(file)
  const at = span(text)
  let inner = at ? text.slice(at.begin + BEGIN.length, at.end) : '\n'
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key} = ${value}`
    inner = keyPattern(key).test(inner) ? inner.replace(keyPattern(key), line) : `${inner}${line}\n`
  }
  const lines = inner.split('\n').filter((l, i, all) => !(l === '' && (i === 0 || i === all.length - 1)))
  await writeManagedBlock(file, lines)
}
