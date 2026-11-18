<script lang="ts">
  import { onMount } from 'svelte'
  import {
    ARB_RESERVE_FACTOR,
    DEFAULT_ARB_STAKE_NANO_ERG,
    MAX_ARB_STAKE_NANO_ERG,
    MIN_ARB_CLIENT,
    MIN_ARB_STAKE_NANO_ERG,
    type ArbReclaimed
  } from '@shared/types'
  import { fmtErg } from './format'
  import Modal from './Modal.svelte'
  import {
    arbView,
    arbWarning,
    copyText,
    reclaimArb,
    refreshArb,
    restartClient,
    saveClientSettings,
    ui
  } from './store.svelte'

  const network = ui.network
  const initialAuto = ui.clientSettings?.arbAutoReserve ?? true
  const initialStake = ui.clientSettings?.arbStakeNanoErg ?? DEFAULT_ARB_STAKE_NANO_ERG

  /** Auto reserve as saved: a reclaim can turn it off without going through Apply. */
  let savedAuto = $state(initialAuto)
  let autoReserve = $state(initialAuto)
  let stakeErg = $state(String(initialStake / 1e9))
  let busy = $state(false)
  let checking = $state(false)
  let error = $state<string | null>(null)
  let copied = $state(false)

  let confirmReclaim = $state(false)
  let alsoTurnOff = $state(initialAuto)
  let reclaiming = $state(false)
  let reclaimError = $state<string | null>(null)
  let reclaimed = $state<ArbReclaimed | null>(null)

  const view = $derived(arbView())
  const warning = $derived(arbWarning(view, fmtErg))
  const stake = $derived(view.stake)
  const clientRunning = $derived(view.live)
  const version = $derived(ui.net?.client.version ?? null)

  /** The stake typed, in nanoERG, or null with a reason when it isn't one. */
  const chosen = $derived.by((): { nanoErg: number } | { error: string } => {
    const text = stakeErg.trim()
    if (!/^\d+(\.\d{1,9})?$/.test(text)) return { error: 'Enter an amount of ERG, like 10 or 2.5' }
    const nanoErg = Math.round(Number(text) * 1e9)
    if (nanoErg < MIN_ARB_STAKE_NANO_ERG) return { error: `At least ${fmtErg(MIN_ARB_STAKE_NANO_ERG)} ERG` }
    if (nanoErg > MAX_ARB_STAKE_NANO_ERG) return { error: `At most ${fmtErg(MAX_ARB_STAKE_NANO_ERG)} ERG` }
    return { nanoErg }
  })
  const chosenNano = $derived('nanoErg' in chosen ? chosen.nanoErg : null)
  const changed = $derived(autoReserve !== savedAuto || (chosenNano !== null && chosenNano !== initialStake))
  const needNano = $derived((chosenNano ?? initialStake) * ARB_RESERVE_FACTOR)

  const statusText = $derived.by((): string => {
    if (!stake) return ''
    if (stake.paused) return 'Paused after a reclaim, until the client restarts'
    if (!stake.enabled) return 'Off in the client: it needs real mining with block transactions'
    if (stake.stakeNanoErg === 0) return autoReserve ? 'Waiting for a stake' : 'No stake to trade with'
    return `Trading with up to ${fmtErg(Math.min(stake.stakeNanoErg, stake.targetNanoErg || stake.stakeNanoErg))} ERG a cycle`
  })

  async function check(): Promise<void> {
    checking = true
    await refreshArb()
    checking = false
  }

  onMount(() => void check())

  function close(): void {
    if (!busy && !reclaiming) ui.dialog = null
  }

  async function copyAddress(): Promise<void> {
    if (!stake) return
    await copyText(stake.address)
    copied = true
    setTimeout(() => (copied = false), 1500)
  }

  async function apply(): Promise<void> {
    if (chosenNano === null) return
    busy = true
    error = await saveClientSettings({
      arbAutoReserve: autoReserve,
      // Left at the client's default unless the user picked another amount.
      ...(chosenNano !== initialStake ? { arbStakeNanoErg: chosenNano } : {})
    })
    if (!error && clientRunning) await restartClient()
    busy = false
    if (!error) ui.dialog = null
  }

  async function reclaim(): Promise<void> {
    reclaiming = true
    reclaimError = null
    const result = await reclaimArb()
    if ('error' in result) reclaimError = result.error
    else {
      reclaimed = result.sent
      confirmReclaim = false
      // Otherwise the client sends a new stake as soon as it restarts.
      if (alsoTurnOff && savedAuto) {
        reclaimError = await saveClientSettings({ arbAutoReserve: false })
        if (!reclaimError) savedAuto = autoReserve = false
      }
    }
    reclaiming = false
  }
</script>

<Modal labelledby="arb-title" onclose={close} width={640}>
  <div class="content">
    <div class="top">
      <span class="micro">Arbitrage · {network}</span>
      <button class="x" aria-label="Close" onclick={close} disabled={busy || reclaiming}>✕</button>
    </div>
    <h2 id="arb-title">Arb reserve</h2>
    <p class="note">
      In blocks you find, the client fills in arbitrage: swaps through ErgoDEX and LithosDex pools that start and end in
      ERG, all in the same block. Each cycle borrows from a stake of ERG kept at your <b>arb address</b> and returns it
      whole; the profit goes to the pool with your batching fees, shared by score. Without a stake there, arb has nothing
      to trade with.
    </p>

    {#if view.supported === false}
      <p class="warn-note">
        Your Lithos Client{version ? ` (${version})` : ''} has no arb. Update to {MIN_ARB_CLIENT} or later under Versions.
        These settings are kept for when you do.
      </p>
    {:else if warning}
      <p class="warn-note"><b>{warning.title}.</b> {warning.text}</p>
    {/if}

    <section class="block">
      <label class="check">
        <input type="checkbox" bind:checked={autoReserve} disabled={busy} />
        Auto reserve: fund the arb address from this wallet
      </label>
      <div class="stake-row">
        <div class="field">
          <label class="micro" for="arb-stake">Stake (ERG)</label>
          <input
            id="arb-stake"
            class="input mono"
            inputmode="decimal"
            bind:value={stakeErg}
            disabled={busy}
            aria-invalid={'error' in chosen}
          />
        </div>
        <div class="presets" role="group" aria-label="Stake presets">
          {#each [5, 10, 25, 50] as p (p)}
            <button class="btn small" class:on={chosenNano === p * 1e9} onclick={() => (stakeErg = String(p))} disabled={busy}>
              {p}
            </button>
          {/each}
        </div>
      </div>
      {#if 'error' in chosen}<p class="error-text">{chosen.error}</p>{/if}
      <ul class="facts">
        <li>
          <span class="micro">Auto reserve</span>
          <span>
            When there is no box of the stake’s size at the arb address, the client sends one from this wallet, paying
            the 0.001 ERG fee. It checks a minute after start, then every ten minutes.
          </span>
        </li>
        <li>
          <span class="micro">Wallet needs</span>
          <span>
            <b class="mono">{fmtErg(needNano)} ERG</b> spendable, twice the stake, so as much stays free for proofs and
            fees. This wallet has
            <b class="mono">{view.balanceNanoErg === null ? 'an unknown amount (unlock it)' : `${fmtErg(view.balanceNanoErg)} ERG`}</b>.
          </span>
        </li>
        <li>
          <span class="micro">Per cycle</span>
          <span>The stake is also the most one cycle puts in. A bigger stake can take bigger gaps between pools.</span>
        </li>
      </ul>
    </section>

    <section class="block">
      <h3 class="micro">Your arb address</h3>
      {#if stake}
        <div class="address well">
          <code class="mono">{stake.address}</code>
          <button class="btn small" onclick={copyAddress}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <ul class="facts">
          <li>
            <span class="micro">Held there</span>
            <span>
              <b class="mono">{fmtErg(stake.nanoErg)} ERG</b> in {stake.boxes} box{stake.boxes === 1 ? '' : 'es'}. It is
              not part of your wallet balance.
            </span>
          </li>
          {#if clientRunning}
            <li>
              <span class="micro">Status</span>
              <span>{statusText}</span>
            </li>
          {/if}
          <li>
            <span class="micro">Send manually</span>
            <span>
              Send ERG here from any wallet to fund arb yourself, with or without auto reserve. Cycles use the largest
              box of at least 0.1 ERG with <b>no tokens</b>; a box smaller than the stake limits cycles to its size.
              Only your wallet’s key can spend it.
            </span>
          </li>
        </ul>
        {#if !clientRunning}
          <p class="note">As the client last read it this session. Start the client to read it again.</p>
        {/if}
      {:else if clientRunning}
        <p class="note">
          {checking ? 'Reading the arb address…' : view.error ? view.error : 'The client hasn’t read the arb address yet.'}
        </p>
      {:else}
        <p class="note">
          The arb address comes from your wallet’s first key under a script of its own. Start the Lithos Client to read it
          and what it holds.
        </p>
      {/if}
      {#if view.error && stake}<p class="error-text">{view.error}</p>{/if}
    </section>

    {#if reclaimed}
      <p class="ok-note" role="status">
        Reclaimed <b class="mono">{fmtErg(reclaimed.nanoErg)} ERG</b> from {reclaimed.boxes} box{reclaimed.boxes === 1
          ? ''
          : 'es'} to your wallet{#if reclaimed.outcome === 'uncertain'}, but the node’s answer was lost: check the address
          before trying again{/if}. Arb is off until the client restarts.{#if reclaimed.remainingBoxes > 0}
          {reclaimed.remainingBoxes} more box{reclaimed.remainingBoxes === 1 ? ' is' : 'es are'} left; reclaim again once
          this confirms.{/if}
        <span class="mono tx">{reclaimed.txId}</span>
      </p>
    {/if}

    {#if stake && stake.nanoErg > 0 && clientRunning}
      <section class="block">
        <h3 class="micro">Withdraw</h3>
        <p class="note">
          Sends everything at the arb address back to your wallet’s first address in one transaction (0.001 ERG fee). Arb
          stops until the client restarts.
        </p>
        {#if confirmReclaim}
          {#if savedAuto && !reclaimed}
            <label class="check">
              <input type="checkbox" bind:checked={alsoTurnOff} disabled={reclaiming} />
              Also turn auto reserve off, so the client doesn’t send a new stake when it restarts
            </label>
          {/if}
          <div class="row">
            <button class="btn" onclick={() => (confirmReclaim = false)} disabled={reclaiming}>Cancel</button>
            <button class="btn danger" onclick={reclaim} disabled={reclaiming}>
              {reclaiming ? 'Reclaiming…' : `Reclaim ${fmtErg(stake.nanoErg)} ERG`}
            </button>
          </div>
        {:else}
          <div class="row">
            <button class="btn" onclick={() => (confirmReclaim = true)}>
              Withdraw to wallet…
            </button>
          </div>
        {/if}
        {#if reclaimError}<p class="error-text" role="alert">{reclaimError}</p>{/if}
      </section>
    {/if}

    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <div class="footer">
      {#if view.supported === false}
        <button class="btn" onclick={() => (ui.dialog = 'versions')}>Versions</button>
      {:else if clientRunning}
        <button class="btn" onclick={check} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
      {/if}
      <button class="btn" onclick={close} disabled={busy || reclaiming}>{changed ? 'Cancel' : 'Close'}</button>
      <button class="btn primary" onclick={apply} disabled={busy || !changed || chosenNano === null}>
        {busy ? 'Applying…' : clientRunning ? 'Apply and restart client' : 'Apply'}
      </button>
    </div>
  </div>
</Modal>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h3 {
    margin: 0;
  }

  .stake-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }

  .stake-row .field {
    width: 140px;
  }

  .presets {
    display: flex;
    gap: 6px;
    padding-bottom: 4px;
  }

  .presets .on {
    border-color: var(--sky);
    color: var(--text-head);
  }

  .address {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
  }

  .address code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--amber-light);
    font-size: 12px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .tx {
    display: block;
    margin-top: 4px;
    overflow-wrap: anywhere;
    font-size: 11.5px;
  }
</style>
