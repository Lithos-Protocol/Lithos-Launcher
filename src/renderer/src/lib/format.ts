export function fmtInt(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—'
}

export function fmtMB(bytes: number | undefined): string {
  return typeof bytes === 'number' ? (bytes / 1_048_576).toFixed(1) : '—'
}

export function fmtPct(fraction: number): string {
  return `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`
}
