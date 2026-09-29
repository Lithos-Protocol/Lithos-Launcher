<script lang="ts">
  import { bondErg, parseConfigDiff } from '@shared/mining'
  import { fmtErg, shortAddress } from './format'
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
    <span class="micro" id="wallet-title">03 · Wallet</span>
    {#if w.phase === 'unlocked'}
      <span class="badge micro ok"><span class="sq" aria-hidden="true"></span>Unlocked</span>
    {:else if w.phase === 'locked' || w.phase === 'unlocking'}
      <span class="badge micro warn"><span class="sq" aria-hidden="true"></span>Locked</span>
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
      <div class="actions">
        <button class="btn primary" onclick={() => (ui.wizard = 'create')}>Create wallet</button>
        <button class="btn" onclick={() => (ui.wizard = 'restore')}>Restore</button>
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
      <div class="address">
        <span class="micro">Address</span>
        <code class="mono" title={w.address ?? ''}>{w.address ? shortAddress(w.address) : '—'}</code>
        <button class="btn small" onclick={copy} disabled={!w.address}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div class="balance">
        <span class="micro">Balance</span>
        <span class="mono" class:zero={w.balanceNanoErg === 0}>
          {w.balanceNanoErg === null ? '—' : `${fmtErg(w.balanceNanoErg)} ERG`}
        </span>
      </div>
      {#if w.balanceNanoErg === 0}
        <p class="note">
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
    gap: 14px;
    padding: 0 20px 20px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
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

  .sq {
    width: 7px;
    height: 7px;
  }

  .ok {
    color: #6ee7b7;
  }

  .ok .sq {
    background: var(--green);
  }

  .warn {
    color: #fcd34d;
  }

  .warn .sq {
    background: var(--amber);
  }

  .address {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    background: var(--bg-deep);
  }

  .balance {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    color: var(--text-head);
    font-size: 13px;
  }

  .balance .zero {
    color: #fcd34d;
  }

  code {
    overflow: hidden;
    color: var(--text-head);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
