<script lang="ts">
  import { NETWORKS } from '@shared/types'
  import { setNetwork, ui } from './store.svelte'

  let { disabled = false }: { disabled?: boolean } = $props()
</script>

<div class="switch" role="radiogroup" aria-label="Network">
  {#each NETWORKS as network (network)}
    <button
      role="radio"
      aria-checked={ui.network === network}
      class={network}
      class:active={ui.network === network}
      {disabled}
      onclick={() => setNetwork(network)}
    >
      {network}
    </button>
  {/each}
</div>

<style>
  /* Pill tabs, like the Mining page's section tabs: mainnet lights cyan, testnet purple. */
  .switch {
    display: inline-flex;
    gap: 3px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: rgba(15, 22, 41, 0.6);
  }

  button {
    padding: 7px 18px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 500;
    text-transform: capitalize;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  button:hover:not(:disabled):not(.active) {
    color: var(--purple-light);
  }

  button:disabled {
    cursor: not-allowed;
  }

  button.active {
    color: #060913;
    font-weight: 600;
  }

  button.mainnet.active {
    background: var(--grad-btn);
  }

  button.testnet.active {
    background: var(--grad-purple);
  }
</style>
