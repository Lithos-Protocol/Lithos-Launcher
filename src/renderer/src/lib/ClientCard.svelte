<script lang="ts">
  import { fmtConfigDiff, fmtHashrate } from '@shared/mining'
  import { DEFAULT_REDUCTION_MULTIPLIER, type ProcStatus } from '@shared/types'
  import StatusDot from './StatusDot.svelte'
  import {
    clientRequirements,
    copyText,
    openLithosPanel,
    setAutoStartClient,
    startClient,
    stopClient,
    ui
  } from './store.svelte'

  const STATUS_TEXT: Record<ProcStatus, string> = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    crashed: 'Stopped unexpectedly'
  }

  let copied = $state(false)

  const status = $derived(ui.client.status)
  const active = $derived(status === 'starting' || status === 'running' || status === 'stopping')
  const running = $derived(status === 'running')
  const shownNetwork = $derived(active && ui.client.network ? ui.client.network : ui.network)
  const requirements = $derived(clientRequirements())
  const ready = $derived(requirements.every((r) => r.ok))
  const settings = $derived(ui.clientSettings)
  const stats = $derived(running ? ui.clientStats : null)

  const stratumPort = $derived(ui.client.ports?.stratum ?? null)
  const stratumUrl = $derived(stratumPort ? `stratum+tcp://${ui.lanAddresses[0] ?? '127.0.0.1'}:${stratumPort}` : null)

  const score = (s: string | null): string => (s ? fmtConfigDiff(Number(s)) : '—')

  /** One line on where the on-chain commitment stands. */
  const commitment = $derived.by((): { text: string; ok: boolean } => {
    if (stats?.committed && stats.pending) {
      return { text: `${score(stats.committed)} on chain, ${score(stats.pending)} from block ${stats.pendingFromHeight ?? '?'}`, ok: true }
    }
    if (stats?.committed) return { text: `${score(stats.committed)} committed on chain`, ok: true }
    if (stats?.pending) return { text: `${score(stats.pending)} takes effect at block ${stats.pendingFromHeight ?? '?'}`, ok: false }
    if (settings?.autoCommit) return { text: running ? 'Auto-commit on, registering…' : 'Auto-commit on', ok: false }
    return { text: 'Not committed', ok: false }
  })

  /** The few things a newcomer must act on, instead of reading warnings in the log. */
  const warnings = $derived.by((): string[] => {
    if (!running) return []
    const list: string[] = []
    if (!settings?.autoCommit && !stats?.committed) {
      list.push('Mining, but not committed on chain: no payouts until you commit your difficulty.')
    }
    if (ui.wallet.balanceNanoErg === 0) {
      list.push('The wallet has no ERG. Each proof needs a small refundable bond, so fund it before you commit.')
    }
    if (stats && stats.rigs === 0) list.push('No mining rigs connected yet.')
    if (stats && stats.rigs > 0 && !stats.hashesPerSecond && (settings?.reductionMultiplier ?? DEFAULT_REDUCTION_MULTIPLIER) >= 10000) {
      list.push(
        'Rig connected, no hashrate yet: with super-shares-only reporting a reading can take a while. Adjust Share reporting to 100× for a quicker one.'
      )
    }
    if (stats?.forcedConfig) list.push('Test mode (forceConfigDiff) is on: proofs at an uncommitted difficulty are rejected.')
    return list
  })

  async function copyStratum(): Promise<void> {
    if (!stratumUrl) return
    await copyText(stratumUrl)
    copied = true
    setTimeout(() => (copied = false), 1500)
  }
</script>

<section class="panel" aria-labelledby="client-title">
  <div class="panel-head">
    <span class="micro" id="client-title">04 · Lithos Client</span>
    <div class="head-right">
      <label class="check small">
        <input
          type="checkbox"
          checked={ui.autoStartClient}
          onchange={(e) => setAutoStartClient(e.currentTarget.checked)}
        />
        Start when ready
      </label>
      <span class="net micro {shownNetwork}">{shownNetwork}</span>
    </div>
  </div>

  <div class="body">
    <div class="status">
      <StatusDot {status} size={12} />
      <div>
        <div class="status-text">{STATUS_TEXT[status]}</div>
        {#if ui.client.detail}
          <div class="detail">{ui.client.detail}</div>
        {/if}
      </div>
    </div>

    <div class="actions">
      {#if active}
        <button class="btn danger" onclick={stopClient} disabled={status === 'stopping'}>
          {status === 'stopping' ? 'Stopping…' : 'Stop client'}
        </button>
      {:else}
        <button class="btn primary" onclick={startClient} disabled={!ready}>Start client</button>
      {/if}
      <button class="btn" onclick={openLithosPanel} disabled={!running}>Lithos panel ↗</button>
    </div>

    <div class="mining info">
      <div class="chip">
        <span class="micro">Difficulty</span>
        <span class="mono val">{settings?.diff ?? 'not set'}</span>
        <button class="link micro" onclick={() => (ui.dialog = 'difficulty')}>{settings?.diff ? 'Change' : 'Choose'}</button>
      </div>
      <div class="chip">
        <span class="micro">Share reporting</span>
        <span class="mono val">{(settings?.reductionMultiplier ?? DEFAULT_REDUCTION_MULTIPLIER).toLocaleString('en-US')}×</span>
        <button class="link micro" onclick={() => (ui.dialog = 'shares')}>Adjust</button>
      </div>
      <div class="chip">
        <span class="micro">Commitment</span>
        <span class="val" class:ok={commitment.ok} class:warn={!commitment.ok}>{commitment.text}</span>
        <button class="link micro" onclick={() => (ui.dialog = 'commit')}>
          {settings?.autoCommit ? 'Details' : 'Commit…'}
        </button>
      </div>
      {#if running}
        <div class="chip">
          <span class="micro">Rigs</span>
          <span class="mono val">{stats?.rigs ?? 0}</span>
          <button class="link micro" onclick={() => (ui.dialog = 'miner')}>Connect a miner</button>
        </div>
        <div class="chip">
          <span class="micro">Hashrate</span>
          <span class="mono val">{stats?.hashesPerSecond ? fmtHashrate(stats.hashesPerSecond) : '—'}</span>
        </div>
        <div class="chip">
          <span class="micro">Super shares</span>
          <span class="mono val">
            {stats?.superShares ?? 0}{stats?.superSharesPerHour ? ` · ${stats.superSharesPerHour.toFixed(1)}/h` : ''}
          </span>
        </div>
      {/if}
    </div>

    {#if running && stratumUrl}
      <div class="endpoint info">
        <span class="micro">Stratum</span>
        <code class="mono" title={ui.lanAddresses.join(', ')}>{stratumUrl}</code>
        <button class="btn small" onclick={copyStratum}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    {:else if !active}
      <ul class="reqs info" aria-label="Requirements">
        {#each requirements as r (r.label)}
          <li class:ok={r.ok}>
            <span class="tick" aria-hidden="true">{r.ok ? '✓' : ''}</span>
            {r.label}
            {#if r.note}<span class="req-note">{r.note}</span>{/if}
            <span class="sr-only">{r.ok ? 'done' : 'not yet'}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if warnings.length}
      <ul class="warnings info">
        {#each warnings as w (w)}<li>{w}</li>{/each}
      </ul>
    {/if}
  </div>

  {#if ui.clientError && ui.clientError !== ui.client.detail}
    <p class="error-text client-error" role="alert">{ui.clientError}</p>
  {/if}
</section>

<style>
  .head-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .check.small {
    font-size: 11.5px;
  }

  .net {
    padding: 2px 8px;
    border: 1px solid;
  }

  .net.mainnet {
    color: var(--sky);
    border-color: rgba(56, 189, 248, 0.35);
  }

  .net.testnet {
    color: var(--purple-light);
    border-color: rgba(168, 85, 247, 0.4);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px 24px;
    padding: 0 20px 16px;
  }

  .info {
    grid-column: 1 / -1;
  }

  .status {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .status :global(.dot) {
    margin-top: 7px;
  }

  .status-text {
    color: var(--text-head);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .detail {
    color: var(--muted);
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 12px;
  }

  .mining {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    background: var(--bg-deep);
    font-size: 12px;
  }

  .val {
    color: var(--text-head);
  }

  .val.ok {
    color: #6ee7b7;
  }

  .val.warn {
    color: #fcd34d;
  }

  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--sky);
    cursor: pointer;
  }

  .link:hover {
    color: var(--sky-light);
  }

  .reqs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--dim);
    font-size: 12px;
  }

  .reqs li {
    display: flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
  }

  .reqs li.ok {
    color: var(--text);
  }

  .tick {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--border-strong);
    color: #04111f;
    font-size: 10px;
    font-weight: 700;
  }

  .ok .tick {
    border-color: var(--green);
    background: var(--green);
  }

  .req-note {
    color: var(--amber);
    font-family: var(--mono);
    font-size: 10.5px;
  }

  .endpoint {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    background: var(--bg-deep);
  }

  code {
    overflow: hidden;
    color: var(--sky-light);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .warnings {
    margin: 0;
    padding: 8px 12px 8px 28px;
    border-left: 2px solid var(--amber);
    background: rgba(245, 158, 11, 0.07);
    color: var(--text);
    font-size: 12px;
  }

  .warnings li + li {
    margin-top: 2px;
  }

  .client-error {
    margin: 0 20px 18px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
