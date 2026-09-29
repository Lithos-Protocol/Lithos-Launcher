<script lang="ts">
  import {
    CONFIG_DIFF_RE,
    PICKS,
    WINDOW_BLOCKS,
    blocksAsTime,
    bondErg,
    diffFor,
    fmtConfigDiff,
    fmtHashrate,
    meanFor,
    miningSeconds,
    parseConfigDiff,
    parseHashrate,
    payChance
  } from '@shared/mining'
  import Modal from './Modal.svelte'
  import { restartClient, saveClientSettings, ui } from './store.svelte'

  const network = ui.network
  const current = ui.clientSettings?.diff ?? null

  let hashrateText = $state('')
  let tableMsText = $state('')
  let customText = $state('')
  let advanced = $state(false)
  let chosenMean = $state<number>(PICKS[0].mean)
  let busy = $state(false)
  let error = $state<string | null>(null)

  const measured = $derived(ui.clientStats?.hashesPerSecond ?? null)
  const hashrate = $derived(parseHashrate(hashrateText))
  const tableMs = $derived(tableMsText.trim() === '' ? 0 : Number(tableMsText))
  const tableMsOk = $derived(Number.isFinite(tableMs) && tableMs >= 0)
  const seconds = $derived(miningSeconds(network, tableMsOk ? tableMs : 0))

  const picks = $derived(
    PICKS.map((p) => ({
      ...p,
      diff: hashrate && seconds > 0 ? fmtConfigDiff(diffFor(hashrate, seconds, p.mean)) : null,
      chance: payChance(p.mean)
    }))
  )

  const custom = $derived(customText.trim().toUpperCase())
  const customOk = $derived(custom === '' || CONFIG_DIFF_RE.test(custom))
  const selected = $derived(custom !== '' ? custom : (picks.find((p) => p.mean === chosenMean)?.diff ?? null))
  const selectedValue = $derived(parseConfigDiff(selected))
  const selectedMean = $derived(hashrate && selectedValue ? meanFor(hashrate, seconds, selectedValue) : null)

  const clientRunning = $derived(ui.client.status === 'running' && ui.client.network === network)
  const committed = $derived(ui.clientStats?.committed ? fmtConfigDiff(Number(ui.clientStats.committed)) : null)

  function close(): void {
    if (!busy) ui.dialog = null
  }

  function useMeasured(): void {
    if (measured) hashrateText = fmtHashrate(measured)
  }

  async function save(restart: boolean): Promise<void> {
    if (!selected || !customOk) return
    busy = true
    error = await saveClientSettings({ diff: selected })
    if (!error && restart) await restartClient()
    busy = false
    if (!error) ui.dialog = null
  }
</script>

<Modal labelledby="difficulty-title" onclose={close} width={660}>
  <div class="content">
    <div class="top">
      <span class="micro">Mining · {network}</span>
      <button class="x" aria-label="Close" onclick={close} disabled={busy}>✕</button>
    </div>
    <h2 id="difficulty-title">Choose your difficulty</h2>
    <p class="note">
      Lithos pays you for proving your hashrate: 10 “super shares” found within {WINDOW_BLOCKS} blocks
      ({blocksAsTime(WINDOW_BLOCKS, network)} on {network}). Your difficulty sets both your cut of each payout and how
      often you manage that proof. Enter your miner's hashrate and the launcher works out the value to use.
    </p>

    <div class="field">
      <label class="micro" for="hashrate">Your miner's hashrate</label>
      <div class="row">
        <input
          id="hashrate"
          class="input mono"
          class:bad={hashrateText.trim() !== '' && !hashrate}
          placeholder="e.g. 150 MH/s"
          autocomplete="off"
          spellcheck="false"
          bind:value={hashrateText}
        />
        {#if measured}
          <button class="btn small" type="button" onclick={useMeasured}>Use measured: {fmtHashrate(measured)}</button>
        {/if}
      </div>
      <span class="hint-line">
        {#if hashrate}
          {Math.round(hashrate).toLocaleString('en-US')} H/s
        {:else if hashrateText.trim()}
          Add a unit: 150 MH/s, 150M or 1.2 GH/s
        {:else}
          Use the rate your miner sustains, not its best peak.
        {/if}
      </span>
    </div>

    <div class="picks" role="radiogroup" aria-label="Difficulty options">
      {#each picks as p (p.mean)}
        <button
          type="button"
          role="radio"
          aria-checked={custom === '' && chosenMean === p.mean}
          class="pick"
          class:on={custom === '' && chosenMean === p.mean}
          class:start={p.mean === 15}
          onclick={() => {
            chosenMean = p.mean
            customText = ''
          }}
        >
          <span class="micro">{p.label}{p.mean === 15 ? ' · recommended' : ''}</span>
          <span class="diff mono">{p.diff ?? '—'}</span>
          <span class="meta">Averages {p.mean} super shares · paid in {Math.round(p.chance * 100)}% of windows</span>
          <span class="meta dim">{p.note}</span>
        </button>
      {/each}
    </div>

    <button class="link micro" type="button" onclick={() => (advanced = !advanced)} aria-expanded={advanced}>
      {advanced ? '− Fewer options' : '+ More options'}
    </button>
    {#if advanced}
      <div class="advanced">
        <div class="field">
          <label class="micro" for="table-ms">Table generation time (ms, optional)</label>
          <input
            id="table-ms"
            class="input mono"
            class:bad={!tableMsOk}
            placeholder="0"
            inputmode="decimal"
            bind:value={tableMsText}
          />
          <span class="hint-line">
            Your rig pauses while Autolykos 2 rebuilds its table at every new block. Enter the rebuild time your
            miner reports and the values above shrink to match.
          </span>
        </div>
        <div class="field">
          <label class="micro" for="custom-diff">Or enter a difficulty yourself</label>
          <input
            id="custom-diff"
            class="input mono"
            class:bad={!customOk}
            placeholder="e.g. 48M"
            autocomplete="off"
            spellcheck="false"
            bind:value={customText}
          />
          {#if !customOk}<span class="hint-line warn">A number and a K, M, G, T or P suffix, e.g. 48M</span>{/if}
        </div>
      </div>
    {/if}

    {#if selected && selectedValue}
      <div class="summary">
        <span>Selected <b class="mono">{selected}</b></span>
        <span>Bond per proof <b class="mono">{bondErg(selectedValue).toFixed(4)} ERG</b> (refunded)</span>
        {#if selectedMean !== null}
          <span>Averages <b class="mono">{selectedMean.toFixed(1)}</b> super shares</span>
        {/if}
      </div>
      {#if selectedMean !== null && selectedMean < 10}
        <p class="error-text">
          Below 10 super shares a window, most windows pay nothing. Choose a lower difficulty.
        </p>
      {/if}
    {/if}

    {#if committed && selected && committed !== selected}
      <p class="note">
        Your on-chain commitment stays at <b class="mono">{committed}</b> until auto-commit sends the change, which the
        contracts allow {blocksAsTime(845, network)} after the last one.
      </p>
    {/if}
    {#if current}
      <p class="note">Current setting: <b class="mono">{current}</b></p>
    {/if}
    {#if error}<p class="error-text" role="alert">{error}</p>{/if}

    <div class="footer">
      <button class="btn" onclick={close} disabled={busy}>Cancel</button>
      {#if clientRunning}
        <button class="btn primary" onclick={() => save(true)} disabled={busy || !selected || !customOk}>
          {busy ? 'Restarting…' : 'Save and restart client'}
        </button>
      {:else}
        <button class="btn primary" onclick={() => save(false)} disabled={busy || !selected || !customOk}>
          Save difficulty
        </button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .row {
    display: flex;
    gap: 12px;
  }

  .row .input {
    flex: 1;
  }

  .bad {
    border-color: var(--red) !important;
  }

  .hint-line {
    color: var(--dim);
    font-size: 11.5px;
  }

  .hint-line.warn {
    color: #fca5a5;
  }

  .picks {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid var(--border-strong);
    background: var(--bg-deep);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .pick:hover {
    border-color: rgba(56, 189, 248, 0.45);
  }

  .pick.on {
    border-color: var(--sky);
    background: rgba(56, 189, 248, 0.08);
    box-shadow: 0 0 0 1px var(--sky);
  }

  .pick.start .micro {
    color: var(--sky-light);
  }

  .diff {
    color: var(--text-head);
    font-size: 22px;
    font-weight: 500;
  }

  .meta {
    font-size: 11.5px;
  }

  .meta.dim {
    color: var(--dim);
  }

  .link {
    align-self: flex-start;
    border: none;
    background: none;
    padding: 0;
    color: var(--sky);
    cursor: pointer;
  }

  .advanced {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    padding: 10px 14px;
    border-left: 2px solid var(--sky);
    background: rgba(56, 189, 248, 0.06);
    font-size: 12.5px;
  }

  .summary b {
    color: var(--text-head);
    font-weight: 500;
  }
</style>
