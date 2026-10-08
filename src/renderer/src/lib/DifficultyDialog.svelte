<script lang="ts">
  import {
    COMMIT_REPLACE_BLOCKS,
    CONFIG_DIFF_RE,
    PICKS,
    WINDOW_BLOCKS,
    blocksAsTime,
    blocksAsWait,
    bondErg,
    diffFor,
    fmtConfigDiff,
    fmtHashrate,
    meanFor,
    miningSeconds,
    parseConfigDiff,
    parseHashrate,
    payChance,
    sameDiff
  } from '@shared/mining'
  import Modal from './Modal.svelte'
  import { chainCommitment, restartClient, saveClientSettings, ui } from './store.svelte'

  const network = ui.network
  const current = ui.clientSettings?.diff ?? null

  let hashrateText = $state('')
  let tableMsText = $state('')
  let customText = $state('')
  let advanced = $state(false)
  let chosen = $state<(typeof PICKS)[number]['label']>('Start')
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
  const selected = $derived(custom !== '' ? custom : (picks.find((p) => p.label === chosen)?.diff ?? null))
  const selectedValue = $derived(parseConfigDiff(selected))
  const selectedMean = $derived(hashrate && selectedValue ? meanFor(hashrate, seconds, selectedValue) : null)

  const clientRunning = $derived(ui.client.status === 'running' && ui.client.network === network)
  const chain = $derived(chainCommitment())
  const autoCommit = $derived(ui.clientSettings?.autoCommit ?? false)
  const pendingWait = $derived(chain?.blocksLeft != null ? blocksAsWait(chain.blocksLeft, network) : null)

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

    {#if chain?.pending}
      <p class="warn-note" role="alert">
        Your commitment of <b class="mono">{fmtConfigDiff(chain.pending)}</b> hasn't taken effect yet: it does at block
        <b class="mono">{chain.fromHeight}</b>{#if pendingWait}, in about {pendingWait}{/if}. Changing your difficulty
        now won't change it: a commitment is locked for {blocksAsTime(COMMIT_REPLACE_BLOCKS, network)} after it's sent.
        {#if autoCommit}
          Auto-commit sends your new difficulty once that lock ends.
        {:else}
          Until you commit your new difficulty once that lock ends{#if chain.replaceableFromHeight}
            (block <b class="mono">{chain.replaceableFromHeight}</b>){/if}, only
          <b class="mono">{fmtConfigDiff(chain.pending)}</b> is used.
        {/if}
      </p>
    {/if}

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
          Use the rate your miner sustains, not its best peak. If using reported hashrate, let it settle after ~10
          minutes of mining.
        {/if}
      </span>
    </div>

    <div class="picks" role="radiogroup" aria-label="Difficulty options">
      {#each picks as p (p.label)}
        <button
          type="button"
          role="radio"
          aria-checked={custom === '' && chosen === p.label}
          class="pick"
          class:on={custom === '' && chosen === p.label}
          class:start={p.label === 'Start'}
          onclick={() => {
            chosen = p.label
            customText = ''
          }}
        >
          <span class="micro">{p.label}{p.label === 'Start' ? ' · recommended' : ''}</span>
          <span class="diff">{p.diff ?? '—'}</span>
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
      <div class="summary info-note">
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

    {#if !chain?.pending && chain?.committed && selectedValue && !sameDiff(selectedValue, chain.committed)}
      <p class="note">
        Your on-chain commitment stays at <b class="mono">{fmtConfigDiff(chain.committed)}</b>
        {#if autoCommit}
          until auto-commit sends the change, which the contracts allow {blocksAsTime(COMMIT_REPLACE_BLOCKS, network)}
          after the last one.
        {:else}
          and only it is used until you commit the new one with Commit… on the Lithos Client card.
        {/if}
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
    color: var(--red-light);
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
    padding: 13px 15px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: var(--well);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      box-shadow 0.2s;
  }

  .pick:hover {
    border-color: rgba(125, 211, 252, 0.4);
  }

  .pick.on {
    border-color: var(--sky);
    background: rgba(56, 189, 248, 0.08);
    box-shadow: 0 0 18px rgba(56, 189, 248, 0.22);
  }

  .pick.start .micro {
    color: var(--sky-light);
  }

  .diff {
    color: var(--text-head);
    font-family: var(--sans);
    font-size: 26px;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.1;
  }

  .meta {
    font-size: 11.5px;
  }

  .meta.dim {
    color: var(--dim);
  }

  .link {
    align-self: flex-start;
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
  }

  .summary b {
    color: var(--text-head);
    font-weight: 600;
  }
</style>
