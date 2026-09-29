<script lang="ts">
  import { bondErg, parseConfigDiff } from '@shared/mining'
  import { fmtErg, fmtInt, fmtPct, shortAddress } from './format'
  import ProgressBar from './ProgressBar.svelte'
  import { copyText, ui, unlockWallet } from './store.svelte'

  let password = $state('')
  let remember = $state(true)
  let error = $state<string | null>(null)
  let copied = $state(false)

  const w = $derived(ui.wallet)
  const secure = $derived(ui.vault?.secure ?? false)
  const diffValue = $derived(parseConfigDiff(ui.clientSettings?.diff))
  const bond = $derived(diffValue ? bondErg(diffValue) : null)
  // A restored or imported wallet scans the whole chain for its history; show how far it has got.
  const chainHeight = $derived(ui.info?.fullHeight ?? null)
  const scanning = $derived(
    w.phase === 'unlocked' && w.walletHeight !== null && chainHeight !== null && w.walletHeight < chainHeight - 3
  )
  const balance = $derived(w.balanceNanoErg === null ? null : fmtErg(w.balanceNanoErg).split('.'))

  async function unlock(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    error = await unlockWallet(password, remember)
    if (!error) password = ''
  }

  /** The side column can scroll; make sure a new error is actually on screen. */
  function reveal(node: HTMLElement): void {
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  async function copy(): Promise<void> {
    if (!w.address) return
    await copyText(w.address)
    copied = true
    setTimeout(() => (copied = false), 1500)
  }
</script>

<section class="panel" aria-labelledby="wallet-title">
  <div class="panel-head">
    <h2 class="card-title" id="wallet-title">
      <span class="swatch you" aria-hidden="true"></span>Wallet<span class="no">03</span>
    </h2>
    {#if w.phase === 'unlocked'}
      <span class="badge micro ok"><span class="dot" aria-hidden="true"></span>Unlocked</span>
    {:else if w.phase === 'locked' || w.phase === 'unlocking'}
      <span class="badge micro warn"><span class="dot" aria-hidden="true"></span>Locked</span>
    {/if}
  </div>

  <div class="body">
    {#if w.phase === 'unavailable'}
      <p class="note">Start the node to create or unlock the wallet Lithos mines with.</p>
    {:else if w.phase === 'uninitialized'}
      <p class="note">
        This node has no wallet yet. The Lithos Client signs its mining transactions with it, so use a wallet made
        just for mining.
      </p>
      <button class="btn primary" onclick={() => (ui.wizard = 'create')}>Create a new wallet</button>
      <div class="actions">
        <button class="btn" onclick={() => (ui.wizard = 'restore')}>Restore seed phrase</button>
        <button class="btn" onclick={() => (ui.wizard = 'keystore')}>Use keystore file</button>
      </div>
    {:else if w.phase === 'unlocking'}
      <p class="note">Unlocking the wallet…</p>
      <ProgressBar value={null} label="Unlocking wallet" />
    {:else if w.phase === 'locked'}
      <form class="unlock" onsubmit={unlock}>
        <div class="field">
          <label class="micro" for="wallet-password">Wallet password</label>
          <input
            id="wallet-password"
            class="input"
            type="password"
            autocomplete="current-password"
            bind:value={password}
          />
        </div>
        {#if secure}
          <label class="check"><input type="checkbox" bind:checked={remember} /> Remember on this computer</label>
        {:else}
          <p class="note">No system keyring found, so the password is kept only until the launcher closes.</p>
        {/if}
        {#if error ?? w.error}
          {#key error ?? w.error}
            <p class="error-text" role="alert" use:reveal>{error ?? w.error}</p>
          {/key}
        {/if}
        <button class="btn primary" type="submit" disabled={!password}>Unlock wallet</button>
      </form>
    {:else}
      <div class="balance">
        <span class="micro">Balance</span>
        <span class="big num" class:zero={w.balanceNanoErg === 0}>
          {#if balance}{balance[0]}{#if balance[1]}<span class="dec">.{balance[1]}</span>{/if}{:else}—{/if}<span
            class="unit">ERG</span
          >
        </span>
      </div>
      <div class="address well">
        <span class="micro">Address</span>
        <code class="mono" title={w.address ?? ''}>{w.address ? shortAddress(w.address) : '—'}</code>
        <button class="btn small" onclick={copy} disabled={!w.address}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {#if scanning && w.walletHeight !== null && chainHeight !== null}
        <div class="scan">
          <div class="scan-head">
            <span class="micro">Scanning history</span>
            <span class="num">{fmtPct(w.walletHeight / chainHeight)}</span>
          </div>
          <ProgressBar value={w.walletHeight / chainHeight} label="Wallet scan" tone="you" />
          <span class="sub">
            Block <span class="num">{fmtInt(w.walletHeight)}</span> of <span class="num">{fmtInt(chainHeight)}</span>.
            The balance fills in as it goes.
          </span>
        </div>
      {/if}
      {#if w.balanceNanoErg === 0 && !scanning}
        <p class="warn-note">
          Send some ERG to this address. Each proof you submit posts a small refundable bond{bond
            ? ` (${bond.toFixed(4)} ERG at your difficulty)`
            : ''} plus a fee.
        </p>
      {/if}
      <p class="note">
        {#if w.passwordKnown && secure}
          Unlocks automatically whenever the node starts.
        {:else if w.passwordKnown}
          Unlocks automatically until the launcher closes.
        {:else}
          You'll be asked for the password next time the node starts.
        {/if}
      </p>
    {/if}
  </div>
</section>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px 20px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .unlock {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .badge {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .ok {
    color: var(--mint);
  }

  .ok .dot {
    background: var(--mint);
    box-shadow: 0 0 8px rgba(110, 231, 183, 0.5);
  }

  .warn {
    color: var(--amber-light);
  }

  .warn .dot {
    background: var(--amber);
  }

  .balance {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  /* The Mining page's big stat: heavy tabular figures, unit in the "you" colour. */
  .big {
    color: var(--text-head);
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
  }

  .big.zero {
    color: var(--amber-light);
  }

  .dec {
    color: var(--muted);
    font-size: 0.62em;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .unit {
    margin-left: 5px;
    color: var(--amber-light);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.07em;
  }

  .address {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 8px 8px 8px 12px;
  }

  code {
    overflow: hidden;
    color: var(--text-head);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scan {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .scan-head {
    display: flex;
    justify-content: space-between;
    color: var(--amber-light);
    font-size: 12px;
    font-weight: 600;
  }

  .sub {
    color: var(--faint);
    font-size: 11px;
  }

  .sub .num {
    color: var(--muted);
  }
</style>
