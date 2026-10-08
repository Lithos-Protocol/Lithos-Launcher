// Node and client releases the launcher no longer runs. A launcher update can retire more: a setup
// still on one is asked to switch before the node or client starts, and the version lists leave
// them out. This file must stay free of Node and DOM imports, and of runtime imports at all, so
// its tests run under plain Node.

/** Compares dotted numeric versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Orders "5.6.0-test" / "1.1.0-prerelease" style versions by their numeric part. */
export function compareLoose(a: string, b: string): number {
  const num = (v: string): string => /^\d+(?:\.\d+)*/.exec(v)?.[0] ?? '0'
  return compareVersions(num(a), num(b))
}

/**
 * Oldest Ergo node the Lithos Client supports (its README): 6.0.7, or its RocksDB twin 6.1.7. A
 * RocksDB build is its LevelDB twin with minor 1, so both lines meet the minimum together.
 */
export const MIN_ERGO_VERSION = '6.0.7'
const MIN_ERGO_ROCKSDB = MIN_ERGO_VERSION.replace(/^(\d+)\.0\./, '$1.1.')

const NO_COMMITMENT_API = 'it has no commitment API, which the launcher reads and sends commitments through'
const PRERELEASE = 'it is a pre-launch build without the commitment API'

/** Lithos Client releases withdrawn from use, and why. */
const RETIRED_CLIENTS: Record<string, string> = {
  '1.0.0-prerelease': PRERELEASE,
  '1.0.0-prerelease-hotfix': PRERELEASE,
  '1.1.0-prerelease': PRERELEASE,
  '1.0.0': NO_COMMITMENT_API,
  '1.0.1': NO_COMMITMENT_API
}

/** Why the launcher won't run this Ergo version, or null if it will. */
export function ergoRetired(version: string): string | null {
  const [major, minor, patch] = version.split('.')
  // Minor 1 is the RocksDB line (see ergoDb in types.ts).
  const twin = minor === '1' ? `${major}.0.${patch}` : version
  if (compareVersions(twin, MIN_ERGO_VERSION) >= 0) return null
  return `Lithos needs Ergo ${MIN_ERGO_VERSION} or newer (${MIN_ERGO_ROCKSDB} or newer on RocksDB)`
}

/** Why the launcher won't run this Lithos Client version, or null if it will. */
export function clientRetired(version: string): string | null {
  return RETIRED_CLIENTS[version] ?? null
}
