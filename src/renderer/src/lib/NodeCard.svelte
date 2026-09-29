<script lang="ts">
  import type { ProcStatus } from '@shared/types'
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

  const status = $derived(ui.node.status)
  const active = $derived(status === 'starting' || status === 'running' || status === 'stopping')
  // While a node runs, this card follows it even if the switch shows the other network.
  const shownNetwork = $derived(active && ui.node.network ? ui.node.network : ui.network)
  const otherNetwork = $derived(active && ui.node.network !== null && ui.node.network !== ui.network)
  const installed = $derived(ui.net?.java.installed && ui.net?.node.installed)

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
    <span class="micro" id="node-title">02 · Ergo node</span>
    <span class="net micro {shownNetwork}">{shownNetwork}</span>
  </div>

  <div class="status">
    <StatusDot {status} size={12} />
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
      {/if}
    </div>
    {#if ui.info}
      <div class="peers mono" title="Connected peers">
        <span class="micro">Peers</span>
        {ui.info.peersCount}
      </div>
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

  .status-body {
    flex: 1;
    min-width: 0;
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

  .stray {
    margin-top: 8px;
  }

  .peers {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    color: var(--text-head);
    font-size: 15px;
  }

  .peers .micro {
    font-size: 9.5px;
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
