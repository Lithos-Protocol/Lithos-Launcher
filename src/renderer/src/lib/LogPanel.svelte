<script lang="ts">
  import type { ProcId } from '@shared/types'
  import StatusDot from './StatusDot.svelte'
  import Terminal from './Terminal.svelte'
  import { ui } from './store.svelte'

  let tab = $state<ProcId>('node')
  let nodeLines = $state(0)
</script>

<section class="panel logs" aria-label="Process output">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'node'} class:active={tab === 'node'} onclick={() => (tab = 'node')}>
      <StatusDot status={ui.node.status} size={7} />
      Ergo node
    </button>
    <button
      role="tab"
      aria-selected={tab === 'client'}
      class:active={tab === 'client'}
      onclick={() => (tab = 'client')}
    >
      <StatusDot status="stopped" size={7} />
      Lithos Client
    </button>
    <span class="spacer"></span>
    {#if tab === 'node'}
      <span class="micro count">{nodeLines.toLocaleString('en-US')} lines</span>
    {/if}
  </div>

  <div class="screen">
    <Terminal proc="node" visible={tab === 'node'} onlines={(n) => (nodeLines = n)} />
    {#if tab === 'node' && nodeLines === 0}
      <div class="empty">
        <span class="micro">No output yet</span>
        <p>The node's console output appears here once it starts.</p>
      </div>
    {:else if tab === 'client'}
      <div class="empty">
        <span class="micro">Not set up</span>
        <p>The Lithos Client's console output will appear here.</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .logs {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .tabs {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
    padding: 0 8px;
  }

  [role='tab'] {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 12px;
    border: none;
    background: none;
    color: var(--dim);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }

  [role='tab']:hover {
    color: var(--text);
  }

  [role='tab'].active {
    color: var(--text-head);
  }

  [role='tab'].active::after {
    content: '';
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: -1px;
    height: 2px;
    background: var(--brand);
  }

  .spacer {
    flex: 1;
  }

  .count {
    align-self: center;
    padding-right: 12px;
  }

  .screen {
    position: relative;
    flex: 1;
    min-height: 0;
    background: #070b16;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    pointer-events: none;
    text-align: center;
  }

  .empty p {
    margin: 0;
    color: var(--dim);
    font-size: 12.5px;
  }
</style>
