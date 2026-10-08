// Reads the Lithos Client's commitment API (`GET`/`POST /mining/commitment`, client 1.0.2 and later)
// and, for older clients, the difficulty block of `/stats`. Pure parsing, so it is tested under Node.
import type { CommitmentBlock, CommitmentEntry, CommitmentRead, CommitmentSent, CommitmentState } from '@shared/types'

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : null
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const STATES: readonly CommitmentState[] = ['unregistered', 'registering', 'waiting', 'active', 'unknown']
const BLOCKS: readonly CommitmentBlock[] = ['TRANSFORMS_DISABLED', 'AUTO_COMMIT', 'UNAVAILABLE', 'IN_FLIGHT', 'SYNCING', 'LOCKED']

function entryOf(v: unknown): CommitmentEntry | null {
  const e = obj(v)
  const score = str(e?.score)
  if (!e || !score || !/^\d+$/.test(score)) return null
  return {
    score,
    declaredHeight: num(e.declaredHeight),
    inForceFromHeight: num(e.inForceFromHeight),
    servedFromHeight: num(e.servedFromHeight)
  }
}

/** `GET /mining/commitment`, or null if the body isn't one. */
export function commitmentOf(v: unknown): CommitmentRead | null {
  const c = obj(v)
  if (!c || !STATES.includes(c.state as CommitmentState)) return null
  const flight = obj(c.inFlight)
  const flightEntry = entryOf(flight?.commitment)
  const timing = obj(c.timing)
  return {
    state: c.state as CommitmentState,
    reason: str(c.reason),
    height: num(c.height),
    inForce: entryOf(c.inForce),
    pending: entryOf(c.pending),
    inFlight:
      flight && flightEntry && str(flight.txId)
        ? {
            txId: str(flight.txId)!,
            kind: flight.kind === 'registration' ? 'registration' : 'change',
            confirmedHeight: num(flight.confirmedHeight),
            commitment: flightEntry
          }
        : null,
    replaceableFromHeight: num(c.replaceableFromHeight),
    canCommit: c.canCommit === true,
    blockedReason: BLOCKS.includes(c.blockedReason as CommitmentBlock) ? (c.blockedReason as CommitmentBlock) : null,
    timing:
      timing && [timing.servedAfterBlocks, timing.inForceAfterBlocks, timing.replaceableAfterBlocks, timing.windowBlocks].every(
        (n) => typeof n === 'number'
      )
        ? {
            servedAfterBlocks: timing.servedAfterBlocks as number,
            inForceAfterBlocks: timing.inForceAfterBlocks as number,
            replaceableAfterBlocks: timing.replaceableAfterBlocks as number,
            windowBlocks: timing.windowBlocks as number
          }
        : null,
    api: true
  }
}

/**
 * An older client's view, from the difficulty block of `/stats`: the score in force, and a pending
 * one with the height it comes into force at (a NISP window after the height it declares). Null
 * when the client couldn't read the list yet, which isn't the same as having no commitment.
 */
export function legacyCommitmentOf(diff: Record<string, unknown>, windowBlocks: number): CommitmentRead | null {
  const committed = str(diff.committed)
  const pending = str(diff.pending)
  const from = num(diff.pendingFromHeight)
  const height = num(diff.checkedHeight)
  if (committed === null && pending === null && height === null) return null
  const declared = from === null ? null : from - windowBlocks
  return {
    state: pending || committed ? (committed ? 'active' : 'waiting') : 'unknown',
    reason: null,
    height,
    inForce: committed ? { score: committed, declaredHeight: null, inForceFromHeight: null, servedFromHeight: null } : null,
    pending: pending
      ? { score: pending, declaredHeight: declared, inForceFromHeight: from, servedFromHeight: declared }
      : null,
    inFlight: null,
    replaceableFromHeight: null,
    canCommit: false,
    blockedReason: null,
    timing: null,
    api: false
  }
}

/** The client's error body as a sentence for the dialog. */
export function commitError(status: number, body: unknown): string {
  if (status === 403) return "The Lithos Client didn't accept the launcher's API key. Restart the client and try again."
  const detail = str(obj(body)?.detail)
  const text = detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : `The Lithos Client answered HTTP ${status}`
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** The body of a `POST /mining/commitment` that succeeded. */
export function sentOf(body: unknown, diff: string): CommitmentSent & { kind: string } {
  const b = obj(body) ?? {}
  return {
    txId: str(b.txId) ?? '',
    kind: str(b.kind) ?? '',
    outcome: str(b.outcome) ?? '',
    diff: str(b.diff) ?? diff,
    declaredHeight: num(b.declaredHeight) ?? 0,
    servedFromHeight: num(b.servedFromHeight) ?? 0,
    inForceFromHeight: num(b.inForceFromHeight) ?? 0,
    replaceableFromHeight: num(b.replaceableFromHeight) ?? 0
  }
}
