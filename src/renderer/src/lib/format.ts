export function fmtInt(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—'
}

export function fmtMB(bytes: number | undefined): string {
  return typeof bytes === 'number' ? (bytes / 1_048_576).toFixed(1) : '—'
}

export function fmtPct(fraction: number): string {
  return `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`
}

export function fmtEta(seconds: number): string {
  if (seconds < 60) return 'less than a minute left'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min left`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `about ${hours} h ${minutes % 60} min left`
  return `about ${Math.round(hours / 24)} days left`
}

/** nanoERG as ERG with up to 4 decimals, e.g. 0.0021. */
export function fmtErg(nanoErg: number): string {
  return Number((nanoErg / 1e9).toFixed(4)).toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** GB for big sizes, MB below 1 GB so small folders don't read as 0.0 GB. */
export function fmtBytesGB(bytes: number): string {
  if (bytes < 2 ** 30) return `${Math.max(0.1, bytes / 2 ** 20).toFixed(1)} MB`
  return `${(bytes / 2 ** 30).toFixed(bytes >= 100 * 2 ** 30 ? 0 : 1)} GB`
}

/** 9fAbc…xYz1 style shortening for long addresses. */
export function shortAddress(address: string, keep = 8): string {
  return address.length <= keep * 2 + 1 ? address : `${address.slice(0, keep)}…${address.slice(-keep)}`
}

/**
 * Progress rate over a sliding two-minute window. Resets when the tracked
 * quantity changes (e.g. sync moves from headers to blocks).
 */
export class RateTracker {
  private samples: { t: number; v: number }[] = []
  private key: string | null = null

  /** Seconds until `value` reaches `target`, or null while there isn't enough data. */
  eta(key: string, value: number, target: number, now = Date.now()): number | null {
    if (key !== this.key) {
      this.key = key
      this.samples = []
    }
    this.samples.push({ t: now, v: value })
    while (this.samples.length > 2 && now - this.samples[0].t > 120_000) this.samples.shift()
    const first = this.samples[0]
    const span = (now - first.t) / 1000
    if (span < 15) return null
    const rate = (value - first.v) / span
    return rate > 0 ? Math.max(0, target - value) / rate : null
  }

  reset(): void {
    this.key = null
    this.samples = []
  }
}
