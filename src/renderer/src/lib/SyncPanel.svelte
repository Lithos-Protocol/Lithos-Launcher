<script lang="ts">
  import { syncView, type SyncStage } from '@shared/sync'
  import { fmtEta, fmtInt, fmtPct } from './format'
  import ProgressBar from './ProgressBar.svelte'
  import { ui } from './store.svelte'

  const ORDER: SyncStage[] = ['connecting', 'headers', 'blocks', 'indexing', 'synced']

  const HEADLINE: Record<SyncStage, string> = {
    connecting: 'Looking for peers',
    headers: 'Downloading block headers',
    blocks: 'Downloading and checking blocks',
    indexing: 'Building the index Lithos needs',
    synced: 'Fully synced and indexed'
  }

  const view = $derived(ui.info ? syncView(ui.info) : null)
  // Until a peer reports the chain height, a target or percentage would be a guess.
  const known = $derived(view !== null && view.stage !== 'connecting')

  const rows = $derived([
    { stage: 'headers' as const, label: 'Headers', value: view?.headers ?? 0 },
    { stage: 'blocks' as const, label: 'Blocks', value: view?.blocks ?? 0 },
    { stage: 'indexing' as const, label: 'Index', value: view?.indexed ?? 0 }
  ])

  function rowState(stage: SyncStage): 'done' | 'active' | 'pending' {
    if (!view) return 'pending'
    const current = ORDER.indexOf(view.stage)
    const mine = ORDER.indexOf(stage)
    return mine < current ? 'done' : mine === current ? 'active' : 'pending'
  }
</script>

<div class="sync" class:synced={view?.stage === 'synced'}>
  <div class="head">
    <span class="micro">Sync</span>
    <span class="headline">{view ? HEADLINE[view.stage] : 'Node not running'}</span>
  </div>

  <ol class="rails">
    {#each rows as row (row.stage)}
      {@const state = rowState(row.stage)}
      {@const fraction = known && view && view.target > 0 ? row.value / view.target : 0}
      <li class="rail {state}">
        <span class="name">{row.label}</span>
        <ProgressBar value={fraction} label="{row.label} sync" />
        <span class="pct num">{known ? fmtPct(fraction) : view ? fmtInt(row.value) : '—'}</span>
        {#if state === 'active' && view}
          <span class="sub">
            <span class="num">{fmtInt(row.value)}</span> / <span class="num">{fmtInt(view.target)}</span> ·
            {ui.syncEta === null ? 'estimating time left…' : fmtEta(ui.syncEta)}
          </span>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<style>
  .sync {
    margin: 0 20px;
    padding: 12px 14px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--well);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .headline {
    color: var(--sky-light);
    font-size: 12px;
    font-weight: 600;
  }

  .synced .headline {
    color: var(--mint);
  }

  .rails {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* One Mining-page rail per stage: name, bar, figure. */
  .rail {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) 52px;
    align-items: center;
    column-gap: 12px;
    row-gap: 4px;
  }

  .name {
    color: var(--dim);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .active .name,
  .done .name {
    color: var(--muted);
  }

  .pct {
    color: var(--dim);
    font-size: 12px;
    font-weight: 600;
    text-align: right;
  }

  .active .pct {
    color: var(--sky-light);
  }

  .done .pct {
    color: var(--text-head);
  }

  .sub {
    grid-column: 2 / -1;
    color: var(--faint);
    font-size: 11px;
  }

  .sub .num {
    color: var(--muted);
  }
</style>
