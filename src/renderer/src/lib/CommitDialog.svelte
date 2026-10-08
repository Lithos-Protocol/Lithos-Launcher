<script lang="ts">
  import { onMount } from 'svelte'
  import { blocksAsTime, blocksAsWait, bondErg, fmtConfigDiff, parseConfigDiff, sameDiff } from '@shared/mining'
  import type { CommitmentSent } from '@shared/types'
  import { fmtErg } from './format'
  import Modal from './Modal.svelte'
  import { chainCommitment, commit, commitTiming, miningBalanceTarget, refreshCommitment, ui } from './store.svelte'

  const network = ui.network
  let understood = $state(false)
  let busy = $state(false)
  let checking = $state(false)
  let error = $state<string | null>(null)
  let sent = $state<CommitmentSent | null>(null)

  const settings = $derived(ui.clientSettings)
  const diff = $derived(settings?.diff ?? null)
  const bond = $derived(diff ? bondErg(parseConfigDiff(diff) ?? 0) : null)
  const balance = $derived(ui.wallet.network === network ? ui.wallet.balanceNanoErg : null)
  const target = $derived(miningBalanceTarget())
  const clientRunning = $derived(ui.client.status === 'running' && ui.client.network === network)
  const chain = $derived(chainCommitment())
  const timing = $derived(commitTiming())
  const untilServed = $derived(chain?.blocksToServed ? blocksAsWait(chain.blocksToServed, network) : null)
  const untilEffect = $derived(chain?.blocksLeft ? blocksAsWait(chain.blocksLeft, network) : null)
  const untilReplaceable = $derived(
    chain?.blocksToReplaceable ? blocksAsWait(chain.blocksToReplaceable, network) : null
  )
  /** The chosen difficulty is already the newest commitment, so there is nothing to send. */
  const alreadyCommitted = $derived(
    chain?.latest != null && sameDiff(parseConfigDiff(diff), chain.latest) && !chain.inFlight
  )

  /** Why the commit button is off, in words; null when it can be pressed. */
  const blocked = $derived.by((): string | null => {
    if (settings?.forceConfigDiff) {
      return 'The client is test mining, which sends no transactions. Start it with Start client to commit.'
    }
    if (!clientRunning) return 'Start the Lithos Client to commit: it sends the transaction from this node’s wallet.'
    if (!chain) return checking ? 'Reading your commitment from the chain…' : 'The client hasn’t read your commitment yet.'
    if (!chain.api) {
      return 'This Lithos Client version can’t commit from the launcher. Update it under Versions, or turn on auto-commit in Settings.'
    }
    if (alreadyCommitted) return `${diff} is already your newest commitment.`
    if (chain.canCommit) return null
    switch (chain.blockedReason) {
      case 'LOCKED':
        return (
          `Your newest commitment is locked until block ${chain.replaceableFromHeight}` +
          (untilReplaceable ? `, in about ${untilReplaceable}.` : '.')
        )
      case 'IN_FLIGHT':
        return 'Your last commitment is still confirming. You can commit again once it has.'
      case 'SYNCING':
        // Right after a start the client's sync reports this until it has processed a block.
        return chain.reason?.includes('has not committed a block yet')
          ? 'The client has just started and is still loading its sync. This usually clears within a minute; this checks again by itself.'
          : `The client is still syncing the miner registry${chain.reason ? ` (${chain.reason})` : ''}. This checks again by itself.`
      case 'AUTO_COMMIT':
        return 'Auto-commit is on, so the client commits by itself. Turn it off in Settings to commit from here.'
      case 'TRANSFORMS_DISABLED':
        return 'The client has transactions turned off, so it can’t commit.'
      default:
        return `The client couldn’t read your commitment${chain.reason ? `: ${chain.reason}` : ''}.`
    }
  })

  async function check(): Promise<void> {
    checking = true
    await refreshCommitment()
    checking = false
  }

  /** Blocks that clear by themselves; the dialog keeps reading while one shows. */
  const settling = $derived(
    clientRunning &&
      (chain?.blockedReason === 'SYNCING' || chain?.blockedReason === 'UNAVAILABLE' || chain?.blockedReason === 'IN_FLIGHT')
  )
  const RECHECK_MS = 10_000

  onMount(() => void check())

  $effect(() => {
    if (!settling || sent) return
    const timer = setInterval(() => void refreshCommitment(), RECHECK_MS)
    return () => clearInterval(timer)
  })

  function close(): void {
    if (!busy) ui.dialog = null
  }

  async function send(): Promise<void> {
    if (!diff) return
    busy = true
    error = null
    const result = await commit(diff)
    busy = false
    if ('error' in result) error = result.error
    else sent = result.sent
  }
</script>

<Modal labelledby="commit-title" onclose={close} width={620}>
  <div class="content">
    <div class="top">
      <span class="micro">Mining · {network}</span>
      <button class="x" aria-label="Close" onclick={close} disabled={busy}>✕</button>
    </div>
    <h2 id="commit-title">Commit your difficulty on chain</h2>

    {#if !diff}
      <p class="note">Choose a difficulty first. The commitment is a promise to mine at it.</p>
      <div class="footer">
        <button class="btn" onclick={close}>Close</button>
        <button class="btn primary" onclick={() => (ui.dialog = 'difficulty')}>Choose difficulty</button>
      </div>
    {:else if sent}
      <p class="ok-note" role="status">
        Commitment of <b class="mono">{sent.diff}</b> sent{#if sent.outcome === 'uncertain'}, but the node’s answer was
          lost: it may still confirm, so check back before sending again{/if}.
      </p>
      <ul class="facts">
        <li>
          <span class="micro">Start mining</span>
          <span>At block <b class="mono">{sent.servedFromHeight}</b>, when the stratum starts mining at it.</span>
        </li>
        <li>
          <span class="micro">Takes effect</span>
          <span>At block <b class="mono">{sent.inForceFromHeight}</b>. NISP submission begins here.</span>
        </li>
        <li>
          <span class="micro">Locked until</span>
          <span>Block <b class="mono">{sent.replaceableFromHeight}</b>.</span>
        </li>
        <li>
          <span class="micro">Transaction</span>
          <span class="mono tx">{sent.txId}</span>
        </li>
      </ul>
      <div class="footer">
        <button class="btn primary" onclick={close}>Done</button>
      </div>
    {:else}
      <p class="note">
        Lithos only pays miners who are registered on chain with a committed difficulty. Until you commit, the client
        mines normally but can’t submit proofs, so you are not paid. Committing sends one transaction from this node’s
        wallet that registers you (the first time) and commits <b class="mono">{diff}</b>.
      </p>

      {#if chain?.inFlight}
        <p class="info-note">
          Your {chain.inFlight.kind === 'registration' ? 'registration' : 'change'} to
          <b class="mono">{fmtConfigDiff(Number(chain.inFlight.commitment.score))}</b> was sent
          {#if chain.inFlight.confirmedHeight}and confirmed at block <b class="mono">{chain.inFlight.confirmedHeight}</b>;
            the client is catching up to it{:else}and is waiting to confirm{/if}.
        </p>
      {:else if chain?.pending}
        <p class="info-note">
          {#if chain.committed}
            Your new commitment of <b class="mono">{fmtConfigDiff(chain.pending)}</b> is on chain. NISP submission under
            it begins at block <b class="mono">{chain.fromHeight}</b>, when it takes effect{#if untilEffect}, in about
              {untilEffect}{/if}. Until then <b class="mono">{fmtConfigDiff(chain.committed)}</b> stays in effect.
          {:else}
            Your commitment of <b class="mono">{fmtConfigDiff(chain.pending)}</b> is on chain.
            {#if chain.early}
              Start mining at block <b class="mono">{chain.servedHeight}</b>, when the stratum starts mining at it{#if untilServed},
                in about {untilServed}{/if}, to build super shares.
            {:else}
              The stratum is mining at it, so mining now builds super shares.
            {/if}
            NISP submission begins at block <b class="mono">{chain.fromHeight}</b>, when it takes effect{#if untilEffect},
              in about {untilEffect}{/if}.
          {/if}
        </p>
      {:else if chain?.committed}
        <p class="info-note">
          Your commitment of <b class="mono">{fmtConfigDiff(chain.committed)}</b> is in effect.
        </p>
      {/if}

      <ul class="facts">
        <li>
          <span class="micro">Start mining</span>
          <span>
            {timing.served} blocks after it’s sent, {blocksAsTime(timing.served, network)}, for a first commitment or a
            higher difficulty. A lower one is mined from when it takes effect.
          </span>
        </li>
        <li>
          <span class="micro">Takes effect</span>
          <span>
            {timing.inForce} blocks after it’s sent, {blocksAsTime(timing.inForce, network)}. NISP submission begins at
            this height.
          </span>
        </li>
        <li>
          <span class="micro">Locked for</span>
          <span>
            {timing.replaceable} blocks, {blocksAsTime(timing.replaceable, network)}. You can’t change it sooner, so pick
            a difficulty you can leave alone.
          </span>
        </li>
        <li>
          <span class="micro">Costs</span>
          <span>
            Registering locks 0.001 ERG in your miner box; each commitment pays a 0.001 ERG fee. Each proof posts a
            refundable bond of <b class="mono">{bond?.toFixed(4)} ERG</b> plus about 0.001 ERG in fees, from this
            node’s wallet. Proofs can overlap, so keep enough for several.
          </span>
        </li>
        <li>
          <span class="micro">First sync</span>
          <span>The client syncs the miner registry before it can register (about 30 minutes on testnet).</span>
        </li>
      </ul>

      <div class="balance">
        <span class="micro">Wallet balance</span>
        <span class="mono">{balance === null ? 'unknown (unlock the wallet)' : `${fmtErg(balance)} ERG`}</span>
        {#if balance !== null && balance < target.nanoErg}
          <span class="warn">
            We recommend at least {fmtErg(target.nanoErg)} ERG to commit {diff} and submit proofs. Send some to this
            wallet’s address, shown on the Wallet card, before you commit.
          </span>
        {/if}
      </div>

      {#if settings?.autoCommit}
        <p class="note">
          Auto-commit is <b>on</b> in Settings. The client keeps your commitment equal to <b class="mono">{diff}</b> by
          itself, sending changes when the contracts allow, so you don’t commit from here.
        </p>
        <div class="footer">
          <button class="btn" onclick={() => (ui.dialog = 'settings')}>Open Settings</button>
          <button class="btn primary" onclick={close}>Close</button>
        </div>
      {:else}
        {#if blocked}
          <p class="warn-note">{blocked}</p>
        {:else}
          <label class="check">
            <input type="checkbox" bind:checked={understood} />
            I understand {diff} will be locked for {blocksAsTime(timing.replaceable, network)} once committed
          </label>
        {/if}
        {#if error}<p class="error-text" role="alert">{error}</p>{/if}
        <div class="footer">
          {#if chain && !chain.api}
            <button class="btn" onclick={() => (ui.dialog = 'versions')}>Versions</button>
          {:else if clientRunning && blocked}
            <button class="btn" onclick={check} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
          {/if}
          <button class="btn" onclick={close} disabled={busy}>Not yet</button>
          <button class="btn primary" onclick={send} disabled={busy || checking || blocked !== null || !understood}>
            {busy ? 'Sending…' : `Commit ${diff}`}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</Modal>

<style>
  .balance {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 14px;
    color: var(--text-head);
  }

  .balance .warn {
    flex-basis: 100%;
    color: var(--amber-light);
    font-size: 12px;
  }

  .tx {
    overflow-wrap: anywhere;
    font-size: 11.5px;
  }
</style>
