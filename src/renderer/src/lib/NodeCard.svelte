<script lang="ts">
  import type { ProcStatus } from '@shared/types'
  import { fmtInt, fmtPct } from './format'
  import ProgressBar from './ProgressBar.svelte'
  import StatusDot from './StatusDot.svelte'
  import { openNodePanel, startNode, stopNode, ui } from './store.svelte'

  const STATUS_TEXT: Record<ProcStatus, string> = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    crashed: 'Stopped unexpectedly'
  }

  const status = $derived(ui.node.status)
  const active = $derived(status === 'starting' || status === 'running' || status === 'stopping')
  // While a node runs, this card follows it even if the switch shows the other network.
  const shownNetwork = $derived(active && ui.node.network ? ui.node.network : ui.network)
  const otherNetwork = $derived(active && ui.node.network !== null && ui.node.network !== ui.network)
  const installed = $derived(ui.net?.java.installed && ui.net?.node.installed)

  const target = $derived(Math.max(ui.info?.headersHeight ?? 0, ui.info?.maxPeerHeight ?? 0))
  const blocksFraction = $derived(target > 0 ? (ui.info?.fullHeight ?? 0) / target : 0)

  const metrics = $derived([
    { label: 'Headers', value: fmtInt(ui.info?.headersHeight) },
    { label: 'Blocks', value: fmtInt(ui.info?.fullHeight) },
    { label: 'Indexed', value: fmtInt(ui.info?.indexedHeight) },
    { label: 'Peers', value: fmtInt(ui.info?.peersCount) }
  ])
</script>

<section class="panel" aria-labelledby="node-title">
  <div class="panel-head">
    <span class="micro" id="node-title">02 · Ergo node</span>
    <span class="net micro {shownNetwork}">{shownNetwork}</span>
  </div>

  <div class="status">
    <StatusDot {status} size={12} />
    <div class="status-body">
      <div class="status-text">{STATUS_TEXT[status]}</div>
      {#if ui.node.detail}
        <div class="detail">{ui.node.detail}</div>
      {:else if otherNetwork}
        <div class="detail">Running on {ui.node.network}. Stop it to start {ui.network}.</div>
      {:else if status === 'stopped' && !installed}
        <div class="detail">Install the components above first.</div>
      {/if}
    </div>
  </div>

  <dl class="metrics">
    {#each metrics as m (m.label)}
      <div class="metric">
        <dt class="micro">{m.label}</dt>
        <dd class="mono">{m.value}</dd>
      </div>
    {/each}
  </dl>

  <div class="sync">
    <div class="sync-row">
      <span class="micro">Block sync</span>
      <span class="mono pct">{ui.info ? fmtPct(blocksFraction) : '—'}</span>
    </div>
    <ProgressBar value={ui.info ? blocksFraction : 0} label="Block sync" />
  </div>

  <div class="actions">
    {#if active}
      <button class="btn danger" onclick={stopNode} disabled={status === 'stopping'}>
        {status === 'stopping' ? 'Stopping…' : 'Stop node'}
      </button>
    {:else}
      <button class="btn primary" onclick={startNode} disabled={!installed}>Start node</button>
    {/if}
    <button class="btn" onclick={openNodePanel} disabled={status !== 'running'}>Node panel ↗</button>
  </div>

  {#if ui.nodeError && ui.nodeError !== ui.node.detail}
    <p class="error-text node-error" role="alert">{ui.nodeError}</p>
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

  .status {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 4px 20px 16px;
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

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .metric {
    padding: 12px 20px;
  }

  .metric + .metric {
    border-left: 1px solid var(--border);
  }

  dt {
    font-size: 9.5px;
  }

  dd {
    margin: 4px 0 0;
    color: var(--text-head);
    font-size: 13px;
    font-weight: 500;
  }

  .sync {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 20px 4px;
  }

  .sync-row {
    display: flex;
    justify-content: space-between;
  }

  .pct {
    color: var(--sky-light);
    font-size: 11.5px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 16px 20px 20px;
  }

  .node-error {
    margin: 0 20px 20px;
  }
</style>
