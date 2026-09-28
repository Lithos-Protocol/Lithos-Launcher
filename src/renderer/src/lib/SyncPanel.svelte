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

  <ol class="rows">
    {#each rows as row (row.stage)}
      {@const state = rowState(row.stage)}
      {@const fraction = view && view.target > 0 ? row.value / view.target : 0}
      <!-- Until a peer reports the chain height, a target or percentage would be a guess. -->
      {@const known = view !== null && view.stage !== 'connecting'}
      <li class="row {state}">
        <span class="marker" aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
        <span class="label">{row.label}</span>
        <span class="mono count">
          {view ? (known ? `${fmtInt(row.value)} / ${fmtInt(view.target)}` : fmtInt(row.value)) : '—'}
        </span>
        <span class="mono pct">{known ? fmtPct(fraction) : ''}</span>
        {#if state === 'active'}
          <div class="bar">
            <ProgressBar value={fraction} label="{row.label} sync" />
            <span class="eta mono">{ui.syncEta === null ? 'estimating time left…' : fmtEta(ui.syncEta)}</span>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<style>
  .sync {
    padding: 14px 20px 6px;
    border-top: 1px solid var(--border);
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
    color: #6ee7b7;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 16px 64px 1fr auto;
    align-items: center;
    column-gap: 10px;
    padding: 6px 0;
  }

  .marker {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--border-strong);
    color: #04111f;
    font-size: 10px;
    font-weight: 700;
  }

  .done .marker {
    border-color: var(--green);
    background: var(--green);
  }

  .active .marker {
    border-color: var(--sky);
    background: rgba(56, 189, 248, 0.3);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  .label {
    color: var(--muted);
    font-size: 12px;
  }

  .active .label,
  .done .label {
    color: var(--text-head);
  }

  .count {
    color: var(--dim);
    font-size: 11px;
    text-align: right;
  }

  .pct {
    min-width: 48px;
    color: var(--muted);
    font-size: 11px;
    text-align: right;
  }

  .active .pct {
    color: var(--sky-light);
  }

  .bar {
    grid-column: 2 / -1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }

  .eta {
    color: var(--dim);
    font-size: 10.5px;
  }
</style>
