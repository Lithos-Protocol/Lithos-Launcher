// The `diff` trade, ported from the Lithos web docs (customWebDocs/src/components/Mining/trade.js)
// so the launcher recommends exactly what the client's Difficulty page does.
//
// Super shares found in one window are Poisson distributed around the average a `diff` produces.
// A window pays only with at least ten, so a lower average pays less often, while `diff` (and with
// it score) is inversely proportional to that average.
import type { Network } from './types'

/** Super shares a NISP carries, and so the fewest a window can pay with. */
export const NISP_SHARES = 10
/** How much harder a super share is than a share at `diff`. */
export const NISP_COEFFICIENT = 10000
/** A window's length in blocks. */
export const WINDOW_BLOCKS = 60
/** Blocks from sending a commitment until it binds, and until it may be replaced. */
export const COMMIT_BINDS_BLOCKS = 125
export const COMMIT_REPLACE_BLOCKS = 845

export const BLOCK_SECONDS: Record<Network, number> = { testnet: 45, mainnet: 120 }

/** The averages the guide names: where to start, the peak, and the floor of the ideal range. */
export const PICKS = [
  { mean: 15, label: 'Start', note: 'Recommended. Paid in about 93% of windows.' },
  { mean: 13, label: 'Peak', note: 'Highest expected earnings, once your hashrate is known.' },
  { mean: 10, label: 'Floor', note: 'Biggest cut, paid about half the time. Never go below.' }
] as const

export const windowSeconds = (network: Network): number => WINDOW_BLOCKS * BLOCK_SECONDS[network]

/**
 * Seconds a rig actually hashes in one window. Autolykos 2 rebuilds its table at every new height
 * and hashes nothing while it does, so each of the window's blocks costs one rebuild.
 */
export const miningSeconds = (network: Network, tableGenMs = 0): number =>
  Math.max(0, windowSeconds(network) - (WINDOW_BLOCKS * Math.max(0, tableGenMs)) / 1000)

/** The `diff` that makes `hashrate` average `mean` super shares per window. */
export const diffFor = (hashrate: number, seconds: number, mean: number): number =>
  (hashrate * seconds) / (NISP_COEFFICIENT * mean)

/** Super shares a `diff` averages per window at `hashrate`. */
export const meanFor = (hashrate: number, seconds: number, diff: number): number =>
  (hashrate * seconds) / (NISP_COEFFICIENT * diff)

/** P(X >= 10) for X ~ Poisson(mean): the chance one window pays. */
export function payChance(mean: number): number {
  if (!(mean > 0)) return 0
  let term = Math.exp(-mean)
  let below = term
  for (let k = 1; k < NISP_SHARES; k++) {
    term *= mean / k
    below += term
  }
  return Math.max(0, 1 - below)
}

const DIFF_SUFFIXES = [
  { suffix: 'P', at: 1e15 },
  { suffix: 'T', at: 1e12 },
  { suffix: 'G', at: 1e9 },
  { suffix: 'M', at: 1e6 },
  { suffix: 'K', at: 1e3 }
]

/**
 * A `diff` written the way `stratum.diff` parses it: three significant figures and a mandatory
 * K/M/G/T/P suffix. The parser rejects a bare number, so anything under a thousand is written in K.
 */
export function fmtConfigDiff(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) return '—'
  const unit = DIFF_SUFFIXES.find((u) => value >= u.at) ?? DIFF_SUFFIXES[DIFF_SUFFIXES.length - 1]
  const m = value / unit.at
  const digits = m >= 100 ? 0 : m >= 10 ? 1 : m >= 1 ? 2 : 3
  return `${Number(m.toFixed(digits))}${unit.suffix}`
}

const RATE_PREFIXES: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }

/** Matches what the client's stratum.diff parser accepts. */
export const CONFIG_DIFF_RE = /^(\d+(?:\.\d+)?|\.\d+)([KMGTP])$/

/** A `stratum.diff` string such as "48M" as a number, or null when it is not one. */
export function parseConfigDiff(text: string | null | undefined): number | null {
  const m = CONFIG_DIFF_RE.exec(String(text ?? '').trim())
  if (!m) return null
  const value = Number(m[1]) * RATE_PREFIXES[m[2]]
  return value > 0 ? value : null
}

/**
 * Hashes per second from what a miner types: "150 MH/s", "150M", "1.2 gh". The unit letter is
 * required: a bare number is almost always a hashrate typed without its unit.
 */
export function parseHashrate(text: string): number | null {
  const m = String(text ?? '')
    .trim()
    .replace(/,/g, '')
    .match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmgtp])\s*(?:h(?:\/s)?|hash(?:es)?(?:\/s)?)?$/i)
  if (!m) return null
  const value = Number(m[1]) * RATE_PREFIXES[m[2].toUpperCase()]
  return value > 0 && Number.isFinite(value) ? value : null
}

/** "150 MH/s" style display of a hashrate. */
export function fmtHashrate(hps: number): string {
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s']
  let v = hps
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`
}

/** The refundable bond each NISP submission posts, in ERG: max(0.002 ERG, diff / 25 nanoERG). */
export const bondErg = (diff: number): number => Math.max(0.002, diff / 25 / 1e9)

/** Roughly how long `blocks` takes on `network`, e.g. "about 28 hours". */
export function blocksAsTime(blocks: number, network: Network): string {
  const minutes = Math.round((blocks * BLOCK_SECONDS[network]) / 60)
  if (minutes < 90) return `about ${minutes} minutes`
  const hours = minutes / 60
  return hours < 48 ? `about ${Math.round(hours)} hours` : `about ${Math.round(hours / 24)} days`
}
