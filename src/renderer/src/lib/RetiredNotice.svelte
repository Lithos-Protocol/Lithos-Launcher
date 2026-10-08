<script lang="ts">
  import type { ProcId } from '@shared/types'
  import { compareLoose } from '@shared/versions'
  import { ui, useVersion } from './store.svelte'

  let { id }: { id: ProcId } = $props()

  const NAME: Record<ProcId, string> = { node: 'Ergo', client: 'Lithos Client' }

  let error = $state<string | null>(null)

  const installed = $derived(ui.net?.[id] ?? null)
  const list = $derived(ui.releases[id])
  const replacement = $derived(list && list.active === installed?.version ? list.replacement : null)
  const action = $derived(
    replacement && installed?.version ? (compareLoose(replacement, installed.version) > 0 ? 'Update' : 'Downgrade') : null
  )

  async function switchVersion(): Promise<void> {
    if (!replacement) return
    error = await useVersion(id, replacement)
  }
</script>

{#if installed?.retired}
  <div class="warn-note retired" role="alert">
    <span>
      {NAME[id]} {installed.version} is retired and won't start: {installed.retired}.
      {#if action === 'Downgrade'}
        No newer release replaces it yet, so go back to {replacement}.
      {/if}
    </span>
    {#if replacement}
      <button class="btn small" onclick={switchVersion} disabled={ui.switching !== null || ui.installing}>
        {ui.switching === id ? 'Switching…' : `${action} to ${replacement}`}
      </button>
    {:else}
      <button class="btn small" onclick={() => (ui.dialog = 'versions')}>Versions</button>
    {/if}
  </div>
  {#if error}<p class="error-text" role="alert">{error}</p>{/if}
{/if}

<style>
  .retired {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 14px;
  }
</style>
