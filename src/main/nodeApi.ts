/** Minimal client for the local Ergo node REST API. */
export class NodeApi {
  constructor(private readonly port: number) {}

  private url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`
  }

  async info(): Promise<Record<string, unknown>> {
    const res = await fetch(this.url('/info'), { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`/info returned HTTP ${res.status}`)
    return (await res.json()) as Record<string, unknown>
  }

  /** Indexer height, or null while the indexer is unavailable. */
  async indexedHeight(): Promise<number | null> {
    try {
      const res = await fetch(this.url('/blockchain/indexedHeight'), { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return null
      const body = (await res.json()) as { indexedHeight?: unknown }
      return typeof body.indexedHeight === 'number' ? body.indexedHeight : null
    } catch {
      return null
    }
  }

  /** blake2b256 of `message`, hex encoded, computed by the node. */
  async blake2b(message: string): Promise<string> {
    const res = await fetch(this.url('/utils/hash/blake2b'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(`Hash request returned HTTP ${res.status}`)
    const hash = await res.json()
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('The node returned a malformed hash')
    return hash
  }

  /** True if the node accepts `apiKey` on a protected endpoint. */
  async accepts(apiKey: string): Promise<boolean> {
    const res = await fetch(this.url('/wallet/status'), {
      headers: { api_key: apiKey },
      signal: AbortSignal.timeout(5000)
    })
    return res.ok
  }

  /** Asks the node to shut down cleanly (it exits a few seconds later). */
  async shutdown(apiKey: string): Promise<void> {
    const res = await fetch(this.url('/node/shutdown'), {
      method: 'POST',
      headers: { api_key: apiKey },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(`Shutdown request returned HTTP ${res.status}`)
  }
}
