<script lang="ts">
  import { fmtInt, fmtPct } from './format'
  import Modal from './Modal.svelte'
  import ProgressBar from './ProgressBar.svelte'
  import { startClient, ui, walletScan } from './store.svelte'

  const scan = $derived(walletScan())

  function close(): void {
    ui.dialog = null
  }

  function wait(): void {
    ui.startWhenWalletSynced = true
    close()
  }

  function startNow(): void {
    ui.startWhenWalletSynced = false
    close()
    void startClient(false)
  }
</script>

<Modal labelledby="wallet-sync-title" onclose={close} width={520}>
  <div class="content">
    <div class="top">
      <span class="micro">Lithos Client · {ui.network}</span>
      <button class="x" aria-label="Close" onclick={close}>✕</button>
    </div>
    <h2 id="wallet-sync-title">The wallet is still catching up</h2>
    <p class="note">
      The Lithos Client pays its bonds and fees from this wallet. Until the node has scanned the wallet up to the latest
      block, it doesn't know about all of the wallet's funds, so the client may find nothing to spend. Test mining
      doesn't need to wait: it sends no transactions.
    </p>

    {#if scan}
      <div class="scan">
        <ProgressBar value={scan.height / scan.tip} label="Wallet scan" tone="you" />
        <span class="sub">
          Block <span class="num">{fmtInt(scan.height)}</span> of <span class="num">{fmtInt(scan.tip)}</span>
          ({fmtPct(scan.height / scan.tip)})
        </span>
      </div>
    {:else}
      <p class="note">The wallet has caught up.</p>
    {/if}

    <div class="footer">
      <button class="btn" onclick={startNow}>Start now anyway</button>
      <button class="btn primary" onclick={wait}>{scan ? 'Start when synced' : 'Start'}</button>
    </div>
  </div>
</Modal>

<style>
  .scan {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sub {
    color: var(--muted);
    font-size: 12px;
  }
</style>
