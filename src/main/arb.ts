// Reads the Lithos Client's arb stake API (`GET /wallet/arb`, `POST /wallet/arb/reclaim`, client
// 1.0.8 and later). Pure parsing, so it is tested under Node.
import type { ArbReclaimed, ArbStake } from '@shared/types'

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** The API sends nanoERG as decimal strings; anything else is not a figure. */
function nano(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : v
  if (typeof s !== 'string' || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** `GET /wallet/arb`, or null if the body isn't one. */
export function arbStakeOf(body: unknown): ArbStake | null {
  const b = obj(body)
  if (!b || typeof b.address !== 'string' || b.address === '') return null
  const target = nano(b.targetNanoErgs)
  const stake = nano(b.stakeNanoErgs)
  const total = nano(b.nanoErgs)
  const boxes = count(b.boxes)
  if (target === null || stake === null || total === null || boxes === null) return null
  return {
    address: b.address,
    enabled: b.enabled === true,
    paused: b.paused === true,
    targetNanoErg: target,
    stakeNanoErg: stake,
    boxes,
    nanoErg: total
  }
}

/** The body of a `POST /wallet/arb/reclaim` that succeeded. */
export function reclaimedOf(body: unknown): ArbReclaimed {
  const b = obj(body) ?? {}
  return {
    txId: typeof b.txId === 'string' ? b.txId : '',
    boxes: count(b.boxes) ?? 0,
    nanoErg: nano(b.nanoErgs) ?? 0,
    outcome: typeof b.outcome === 'string' ? b.outcome : '',
    remainingBoxes: count(b.remainingBoxes) ?? 0
  }
}
