import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Network } from '@shared/types'
import { writeFileAtomic } from './util'

/**
 * launcher.json: the only settings the launcher keeps outside ergo.conf / lithos.conf, and only
 * for things those files can't hold. Absent entirely unless the user changes one of them.
 */
export interface LauncherSettings {
  v: 1
  /** Install folder, when not the default ~/Lithos. */
  root?: string
  /** JVM heap overrides in MB; absent means sized from system RAM. */
  heap?: { nodeMb?: number; clientMb?: number }
  /** Node data folders adopted from an existing setup, used in place. */
  dataDirs?: Partial<Record<Network, string>>
}

const file = (): string => join(app.getPath('userData'), 'launcher.json')

let current: LauncherSettings = { v: 1 }

/** Read synchronously at startup, before anything asks for the install folder. */
export function loadSettings(): LauncherSettings {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Partial<LauncherSettings>
    if (parsed.v === 1) current = { ...parsed, v: 1 }
  } catch {
    current = { v: 1 }
  }
  return current
}

export function settings(): LauncherSettings {
  return current
}

export async function updateSettings(patch: (s: LauncherSettings) => void): Promise<LauncherSettings> {
  const next: LauncherSettings = JSON.parse(JSON.stringify(current))
  patch(next)
  current = next
  await writeFileAtomic(file(), JSON.stringify(current, null, 2))
  return current
}
