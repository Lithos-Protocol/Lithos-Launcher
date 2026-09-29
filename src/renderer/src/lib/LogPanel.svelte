<script lang="ts">
  import type { ProcId } from '@shared/types'
  import StatusDot from './StatusDot.svelte'
  import Terminal from './Terminal.svelte'
  import { ui } from './store.svelte'

  let tab = $state<ProcId>('node')
  let lines = $state<Record<ProcId, number>>({ node: 0, client: 0 })

  const EMPTY: Record<ProcId, string> = {
    node: "The node's console output appears here once it starts.",
    client: "The Lithos Client's console output appears here once it starts."
  }
</script>

<section class="panel logs" aria-label="Process output">
  <div class="panel-head">
    <h2 class="card-title">Console</h2>
    <div class="tabs" role="tablist">
      <button
        role="tab"
        class="network"
        aria-selected={tab === 'node'}
        class:active={tab === 'node'}
        onclick={() => (tab = 'node')}
      >
        <StatusDot status={ui.node.status} size={7} />
        Ergo node
      </button>
      <button
        role="tab"
        class="lithos"
        aria-selected={tab === 'client'}
        class:active={tab === 'client'}
        onclick={() => (tab = 'client')}
      >
        <StatusDot status={ui.client.status} size={7} />
        Lithos Client
      </button>
    </div>
    <span class="spacer"></span>
    <span class="micro count">{lines[tab].toLocaleString('en-US')} lines</span>
  </div>

  <div class="screen">
    <Terminal proc="node" visible={tab === 'node'} onlines={(n) => (lines.node = n)} />
    <Terminal proc="client" visible={tab === 'client'} onlines={(n) => (lines.client = n)} />
    {#if lines[tab] === 0}
      <div class="empty">
        <span class="micro">No output yet</span>
        <p>{EMPTY[tab]}</p>
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

  .panel-head {
    justify-content: flex-start;
    gap: 16px;
  }

  /* The Mining page's segmented control: a pill track, the chosen tab lit in its role's colour. */
  .tabs {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid rgba(125, 211, 252, 0.12);
    border-radius: 999px;
    background: rgba(10, 15, 30, 0.7);
  }

  [role='tab'] {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 13px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--dim);
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  [role='tab']:hover {
    color: var(--sky-light);
  }

  [role='tab'].network.active {
    background: rgba(56, 189, 248, 0.16);
    color: var(--sky-light);
    font-weight: 600;
  }

  [role='tab'].lithos.active {
    background: rgba(168, 85, 247, 0.18);
    color: var(--purple-light);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .screen {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 0 12px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #050811;
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
