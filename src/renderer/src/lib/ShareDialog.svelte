<script lang="ts">
  import { NISP_COEFFICIENT, fmtConfigDiff, fmtHashrate, parseConfigDiff, windowSeconds } from '@shared/mining'
  import { DEFAULT_REDUCTION_MULTIPLIER } from '@shared/types'
  import Modal from './Modal.svelte'
  import { restartClient, saveClientSettings, ui } from './store.svelte'

  // Slider left to right: fewer shares to more shares.
  const STEPS = [10000, 1000, 100, 10] as const
  const network = ui.network

  const initial = ui.clientSettings?.reductionMultiplier ?? DEFAULT_REDUCTION_MULTIPLIER
  let pos = $state(Math.max(0, STEPS.indexOf(initial as (typeof STEPS)[number])))
  let busy = $state(false)
  let error = $state<string | null>(null)

  const multiplier = $derived(STEPS[pos])
  const diff = $derived(parseConfigDiff(ui.clientSettings?.diff))
  const measured = $derived(ui.clientStats?.hashesPerSecond ?? null)
  // Without a measurement, assume the difficulty was chosen for averaging 15 super shares.
  const hashrate = $derived(measured ?? (diff ? (diff * NISP_COEFFICIENT * 15) / windowSeconds(network) : null))
  const seconds = $derived(hashrate && diff ? (diff * multiplier) / hashrate : null)
  const clientRunning = $derived(ui.client.status === 'running' && ui.client.network === network)

  function every(s: number): string {
    if (s < 1) return 'several times a second'
    if (s < 90) return `about every ${Math.round(s)} s`
    if (s < 5400) return `about every ${Math.round(s / 60)} min`
    return `about every ${Math.round(s / 3600)} h`
  }

  function close(): void {
    if (!busy) ui.dialog = null
  }

  async function apply(): Promise<void> {
    busy = true
    error = await saveClientSettings({ reductionMultiplier: multiplier })
    if (!error && clientRunning) await restartClient()
    busy = false
    if (!error) ui.dialog = null
  }
</script>

<Modal labelledby="shares-title" onclose={close} width={560}>
  <div class="content">
    <div class="top">
      <span class="micro">Mining · {network}</span>
      <button class="x" aria-label="Close" onclick={close} disabled={busy}>✕</button>
    </div>
    <h2 id="shares-title">Share reporting</h2>
    <p class="note">
      How often your miner reports shares to the client. It only changes how chatty the miner is: Lithos pays on your
      difficulty either way.
    </p>

    <div class="slider">
      <input
        type="range"
        min="0"
        max={STEPS.length - 1}
        step="1"
        bind:value={pos}
        aria-label="Share reporting"
        aria-valuetext="{multiplier.toLocaleString('en-US')} times your difficulty"
      />
      <div class="ticks" aria-hidden="true">
        {#each STEPS as s (s)}<span>{s.toLocaleString('en-US')}×</span>{/each}
      </div>
      <div class="ends micro" aria-hidden="true"><span>Fewer shares</span><span>More shares</span></div>
    </div>

    <ul class="facts">
      <li>
        <span class="micro">Miner is sent</span>
        <span>
          <b class="mono">{diff ? fmtConfigDiff(diff * multiplier) : '—'}</b>
          ({multiplier.toLocaleString('en-US')}× your {ui.clientSettings?.diff ?? '—'}){multiplier === 10000
            ? ', so it reports only super shares'
            : ''}
        </span>
      </li>
      <li>
        <span class="micro">Shares</span>
        <span>
          {#if seconds !== null}
            {every(seconds)}{hashrate ? ` at ${fmtHashrate(hashrate)}` : ''}{measured ? ' (measured)' : ' (estimated from your difficulty)'}
          {:else}
            Choose a difficulty first
          {/if}
        </span>
      </li>
    </ul>
    <p class="note">
      Lower multipliers give a steadier hashrate reading in your miner and here. Very frequent shares can cause
      duplicate or old-share errors; if you see those, move the slider left.
    </p>

    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <div class="footer">
      <button class="btn" onclick={close} disabled={busy}>Cancel</button>
      <button class="btn primary" onclick={apply} disabled={busy || multiplier === initial}>
        {busy ? 'Applying…' : clientRunning ? 'Apply and restart client' : 'Apply'}
      </button>
    </div>
  </div>
</Modal>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--sky);
  }

  .ticks,
  .ends {
    display: flex;
    justify-content: space-between;
  }

  .ticks {
    color: var(--text-head);
    font-family: var(--mono);
    font-size: 12px;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    background: var(--bg-deep);
    list-style: none;
    font-size: 12.5px;
  }

  .facts li {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 12px;
  }

  .facts b {
    color: var(--text-head);
    font-weight: 500;
  }
</style>
