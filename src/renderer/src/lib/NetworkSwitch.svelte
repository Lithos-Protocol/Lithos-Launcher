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
  .switch {
    display: flex;
    border: 1px solid var(--border-strong);
    background: rgba(6, 9, 19, 0.6);
  }

  button {
    position: relative;
    padding: 8px 18px;
    border: none;
    background: transparent;
    color: var(--dim);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  button:hover:not(:disabled) {
    color: var(--text);
  }

  button:disabled {
    cursor: not-allowed;
  }

  button.active {
    color: var(--text-head);
  }

  button.mainnet.active {
    background: rgba(56, 189, 248, 0.1);
  }

  button.testnet.active {
    background: rgba(168, 85, 247, 0.12);
  }

  button.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
  }

  button.mainnet.active::after {
    background: var(--sky);
  }

  button.testnet.active::after {
    background: var(--purple);
  }
</style>
