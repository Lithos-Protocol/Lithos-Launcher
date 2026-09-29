<script lang="ts">
  import { syncView, type SyncStage } from '@shared/sync'
  import type { ProcStatus } from '@shared/types'
  import Ring from './Ring.svelte'
  import StatusDot from './StatusDot.svelte'
  import SyncPanel from './SyncPanel.svelte'
  import { errorText, openNodePanel, startNode, stopNode, ui } from './store.svelte'

  const STATUS_TEXT: Record<ProcStatus, string> = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    crashed: 'Stopped unexpectedly'
  }

  const RING_CAPTION: Record<SyncStage, string> = {
    connecting: 'peers',
    headers: 'syncing',
    blocks: 'syncing',
    indexing: 'indexing',
    synced: 'synced'
  }

  const status = $derived(ui.node.status)
  const active = $derived(status === 'starting' || status === 'running' || status === 'stopping')
  // While a node runs, this card follows it even if the switch shows the other network.
  const shownNetwork = $derived(active && ui.node.network ? ui.node.network : ui.network)
  const otherNetwork = $derived(active && ui.node.network !== null && ui.node.network !== ui.network)
  const installed = $derived(ui.net?.java.installed && ui.net?.node.installed)
  const view = $derived(ui.info ? syncView(ui.info) : null)
  // Headers, blocks and index weigh the same: the node is ready for Lithos when all three are done.
  const overall = $derived(
    view && view.stage !== 'connecting' && view.target > 0
      ? view.stage === 'synced'
        ? 1
        : (view.headers + view.blocks + view.indexed) / (3 * view.target)
      : null
  )

  async function stopStray(): Promise<void> {
    ui.nodeError = null
    try {
      await window.lithos.stopStrayNode(ui.network)
    } catch (err) {
      ui.nodeError = errorText(err)
    }
  }
</script>

<section class="panel" aria-labelledby="node-title">
  <div class="panel-head">
    <h2 class="card-title" id="node-title">
      <span class="swatch network" aria-hidden="true"></span>Ergo node<span class="no">02</span>
    </h2>
    <span class="net micro {shownNetwork}">{shownNetwork}</span>
  </div>

  <div class="status">
    <StatusDot {status} size={10} />
    <div class="status-body">
      <div class="status-text">{STATUS_TEXT[status]}</div>
      {#if ui.node.detail}
        <div class="detail">{ui.node.detail}</div>
        {#if ui.node.stray}
          <button class="btn small stray" onclick={stopStray}>Stop it</button>
        {/if}
      {:else if otherNetwork}
        <div class="detail">Running on {ui.node.network}. Stop it to start {ui.network}.</div>
      {:else if status === 'stopped' && !installed}
        <div class="detail">Install the components above first.</div>
      {:else if ui.info}
        <div class="detail micro">
          {ui.info.peersCount} peers{ui.info.appVersion ? ` · v${ui.info.appVersion}` : ''}
        </div>
      {/if}
    </div>
    {#if view}
      <Ring value={overall} caption={RING_CAPTION[view.stage]} done={view.stage === 'synced'} />
    {/if}
  </div>

  <SyncPanel />

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
  .status {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 20px 14px;
  }

  .status-body {
    flex: 1;
    min-width: 0;
  }

  .status-text {
    color: var(--text-head);
    font-family: var(--display);
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }

  .detail {
    margin-top: 2px;
    color: var(--muted);
    font-size: 12px;
  }

  .detail.micro {
    color: var(--dim);
  }

  .stray {
    margin-top: 8px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 14px 20px 20px;
  }

  .node-error {
    margin: 0 20px 20px;
  }
</style>
