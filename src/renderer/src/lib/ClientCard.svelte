<script lang="ts">
  import { syncView } from '@shared/sync'
  import type { ProcStatus } from '@shared/types'
  import StatusDot from './StatusDot.svelte'
  import { copyText, openLithosPanel, startClient, stopClient, ui } from './store.svelte'

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
  const shownNetwork = $derived(active && ui.client.network ? ui.client.network : ui.network)

  const nodeUp = $derived(ui.node.status === 'running' && ui.node.network === ui.network)
  const synced = $derived(nodeUp && ui.info !== null && syncView(ui.info).stage === 'synced')
  const requirements = $derived([
    { label: 'Client installed', ok: ui.net?.client.installed ?? false, note: '' },
    { label: 'Node running', ok: nodeUp, note: '' },
    {
      label: 'Node synced',
      ok: synced || (ui.skipSyncGate && nodeUp),
      note: ui.skipSyncGate && !synced ? 'skipped (dev)' : ''
    },
    { label: 'Wallet unlocked', ok: ui.wallet.phase === 'unlocked' && ui.wallet.network === ui.network, note: '' }
  ])
  const ready = $derived(requirements.every((r) => r.ok))

  const stratumHost = $derived(ui.lanAddresses[0] ?? '127.0.0.1')
  const stratumPort = $derived(ui.client.ports?.stratum ?? null)
  const stratumUrl = $derived(stratumPort ? `stratum+tcp://${stratumHost}:${stratumPort}` : null)

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
    <span class="net micro {shownNetwork}">{shownNetwork}</span>
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
      <button class="btn" onclick={openLithosPanel} disabled={status !== 'running'}>Lithos panel ↗</button>
    </div>

    {#if status === 'running' && stratumUrl}
      <div class="endpoints info">
        <div class="endpoint">
          <span class="micro">Stratum</span>
          <code class="mono" title={ui.lanAddresses.join(', ')}>{stratumUrl}</code>
          <button class="btn small" onclick={copyStratum}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p class="note">Point your mining software at this address. Rigs on this PC can also use 127.0.0.1.</p>
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
  </div>

  {#if ui.clientError && ui.clientError !== ui.client.detail}
    <p class="error-text client-error" role="alert">{ui.clientError}</p>
  {/if}
</section>

<style>
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
    gap: 14px 24px;
    padding: 4px 20px 18px;
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

  .endpoints {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
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

  .actions {
    display: flex;
    gap: 12px;
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
