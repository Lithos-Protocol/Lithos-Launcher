<script lang="ts">
  import { blocksAsTime, blocksAsWait, fmtConfigDiff, fmtHashrate, parseConfigDiff, sameDiff } from '@shared/mining'
  import { DEFAULT_REDUCTION_MULTIPLIER, type ProcStatus } from '@shared/types'
  import RetiredNotice from './RetiredNotice.svelte'
  import StatusDot from './StatusDot.svelte'
  import {
    chainCommitment,
    clientRequirements,
    commitTiming,
    copyApiKey,
    copyText,
    openLithosPanel,
    requestStartClient,
    setAutoStartClient,
    startClient,
    stopClient,
    ui
  } from './store.svelte'

  const STATUS_TEXT: Record<ProcStatus, string> = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    crashed: 'Stopped unexpectedly'
  }

  let copied = $state<string | null>(null)
  let keyCopied = $state(false)

  const status = $derived(ui.client.status)
  const active = $derived(status === 'starting' || status === 'running' || status === 'stopping')
  const running = $derived(status === 'running')
  const shownNetwork = $derived(active && ui.client.network ? ui.client.network : ui.network)
  const requirements = $derived(clientRequirements())
  // Soft requirements (the wallet scan) don't block the button; pressing it asks whether to wait.
  const ready = $derived(requirements.every((r) => r.ok || r.soft))
  const waiting = $derived(ui.startWhenWalletSynced && !active)
  const settings = $derived(ui.clientSettings)
  const stats = $derived(running ? ui.clientStats : null)

  const lanHost = $derived(ui.lanAddresses[0] ?? null)
  const stratumPort = $derived(ui.client.ports?.stratum ?? null)
  const stratumUrl = $derived(stratumPort ? `stratum+tcp://${lanHost ?? '127.0.0.1'}:${stratumPort}` : null)
  const httpPort = $derived(ui.client.ports?.http ?? null)
  const lanPanelUrl = $derived(settings?.lanPanel && lanHost && httpPort ? `http://${lanHost}:${httpPort}/` : null)

  const hashrate = $derived(stats?.hashesPerSecond ? fmtHashrate(stats.hashesPerSecond).split(' ') : null)
  const chain = $derived(chainCommitment())

  /** Where the on-chain commitment stands: a headline figure and one line under it. */
  const commitment = $derived.by((): { value: string; text: string; ok: boolean } => {
    if (chain?.committed && chain.pending) {
      return {
        value: fmtConfigDiff(chain.committed),
        text: `${fmtConfigDiff(chain.pending)} from block ${chain.fromHeight}`,
        ok: true
      }
    }
    const sent = chain?.inFlight ? fmtConfigDiff(Number(chain.inFlight.commitment.score)) : null
    if (chain?.committed && sent) return { value: fmtConfigDiff(chain.committed), text: `Change to ${sent} confirming…`, ok: true }
    if (chain?.committed) return { value: fmtConfigDiff(chain.committed), text: 'Committed on chain', ok: true }
    if (chain?.pending) {
      return {
        value: fmtConfigDiff(chain.pending),
        text: `Mined from block ${chain.servedHeight}, in effect at ${chain.fromHeight}`,
        ok: false
      }
    }
    if (sent) return { value: sent, text: 'Registration confirming…', ok: false }
    if (chain?.state === 'registering') return { value: '—', text: 'Registered, client syncing…', ok: false }
    if (settings?.forceConfigDiff) return { value: '—', text: 'Paused while test mining', ok: false }
    if (settings?.autoCommit) return { value: '—', text: running ? 'Auto-commit on, registering…' : 'Auto-commit on', ok: false }
    if (!chain) return { value: '—', text: running ? 'Reading the chain…' : 'Unknown until the client runs', ok: false }
    return { value: '—', text: 'Not committed: not paid', ok: false }
  })
  const commitmentSource = $derived(
    chain && !chain.live
      ? `As the client last read it${chain.readAt ? `, at block ${chain.readAt}` : ''}. Updates when it runs again.`
      : undefined
  )

  const testMode = $derived(Boolean(settings?.forceConfigDiff || stats?.forcedConfig))
  /** The client read no commitment, and none is on its way: mining isn't paid. */
  const uncommitted = $derived(
    chain !== null &&
      !chain.latest &&
      !chain.inFlight &&
      (chain.state === 'unregistered' || (!chain.api && chain.state === 'unknown'))
  )
  /** Mining for real without a commitment; test mining earns nothing anyway and says so itself. */
  const unpaid = $derived(uncommitted && !testMode)

  interface Alert {
    tone: 'red' | 'amber'
    title: string
    text: string
    action?: { label: string; run: () => void }
  }

  async function mineForReal(): Promise<void> {
    await stopClient()
    requestStartClient()
  }

  /** The two states that earn nothing, said loudly: test mining, and mining without a commitment. */
  const alert = $derived.by((): Alert | null => {
    if (running && testMode) {
      return {
        tone: 'amber',
        title: 'Test mining: you are not earning',
        text:
          'The client sends no transactions, so nothing is committed, proven or paid. Use it to try out a difficulty, ' +
          'then mine for real.',
        action: { label: 'Mine for real', run: () => void mineForReal() }
      }
    }
    if (!active && settings?.forceConfigDiff && ui.autoStartClient) {
      return {
        tone: 'amber',
        title: 'Set to test mining',
        text:
          'The client last ran in test mining, so Start when ready starts it that way again, earning nothing. ' +
          'Start client mines for real.'
      }
    }
    if (!unpaid) return null
    if (settings?.autoCommit) {
      return {
        tone: 'amber',
        title: 'Not committed yet: you are not being paid',
        text:
          `Auto-commit registers you and commits ${settings.diff ?? 'your difficulty'} once the client has synced the miner ` +
          'registry. Payouts start once that commitment takes effect.'
      }
    }
    return {
      tone: 'red',
      title: 'No difficulty commitment: you are not being paid',
      text:
        `Lithos pays nothing for this mining until your difficulty is committed on chain. Commit ` +
        `${settings?.diff ?? 'your difficulty'} to register; it takes effect about ` +
        `${blocksAsTime(commitTiming().inForce, shownNetwork).replace(/^about /, '')} after it's sent.`,
      action: { label: 'Commit…', run: () => (ui.dialog = 'commit') }
    }
  })

  /** The few things a newcomer must act on, instead of reading warnings in the log. */
  const warnings = $derived.by((): string[] => {
    if (!running) return []
    const list: string[] = []
    if (!testMode && !settings?.autoCommit && !chain?.inFlight && chain?.state !== 'registering') {
      if (chain?.latest && settings?.diff && !sameDiff(parseConfigDiff(settings.diff), chain.latest)) {
        const onChain = fmtConfigDiff(chain.latest)
        list.push(
          `Your difficulty is set to ${settings.diff}, but your on-chain commitment is ${onChain}. Only ${onChain} is ` +
            `used until you commit ${settings.diff}.`
        )
      }
    }
    if (!testMode && chain?.early) {
      const at = chain.servedHeight
      list.push(
        chain.blocksToServed !== null
          ? `You should not start mining until block ${at}, when the stratum starts mining at your commitment. The ` +
              `height is currently ${chain.height}, so it will take an estimated ${blocksAsWait(chain.blocksToServed, shownNetwork)}.`
          : `You should not start mining until block ${at}, when the stratum starts mining at your commitment.`
      )
      list.push('Your client does not need to be on while waiting for commitments.')
      if (stats && stats.rigs > 0) {
        list.push(`Your rigs are mining before block ${at}. You will not be paid for this mining.`)
      }
    } else if (!testMode && chain?.waiting) {
      list.push(
        `The stratum is mining at your commitment, so mining now builds super shares for it. NISP submission begins at block ` +
          `${chain.fromHeight}, when it takes effect` +
          (chain.blocksLeft !== null ? `, in about ${blocksAsWait(chain.blocksLeft, shownNetwork)}.` : '.')
      )
      if (stats && stats.rigs === 0) list.push('No mining rigs connected yet.')
    } else if (stats && stats.rigs === 0) {
      list.push('No mining rigs connected yet.')
    } else if (stats && stats.rigs > 0 && !stats.hashesPerSecond && (settings?.reductionMultiplier ?? DEFAULT_REDUCTION_MULTIPLIER) >= 10000) {
      list.push(
        'Rig connected, no hashrate yet: with super-shares-only reporting a reading can take a while. Adjust Share reporting to 100× for a quicker one.'
      )
    }
    return list
  })

  async function copy(text: string): Promise<void> {
    await copyText(text)
    copied = text
    setTimeout(() => (copied = null), 1500)
  }

  async function copyKey(): Promise<void> {
    const network = ui.client.network
    if (!network) return
    ui.clientError = await copyApiKey(network, 'lithos')
    if (ui.clientError) return
    keyCopied = true
    setTimeout(() => (keyCopied = false), 1500)
  }
</script>

<section class="panel" aria-labelledby="client-title">
  <div class="panel-head">
    <h2 class="card-title" id="client-title">
      <span class="swatch lithos" aria-hidden="true"></span>Lithos Client<span class="no">04</span>
    </h2>
    <div class="head-right">
      <label class="check small">
        <input
          type="checkbox"
          checked={ui.autoStartClient}
          onchange={(e) => setAutoStartClient(e.currentTarget.checked)}
        />
        Start when ready
      </label>
      <span class="net micro {shownNetwork}">{shownNetwork}</span>
    </div>
  </div>

  <div class="body">
    <div class="top">
      <div class="status">
        <StatusDot {status} size={10} />
        <div>
          <div class="status-text">{running && settings?.forceConfigDiff ? 'Test mining' : STATUS_TEXT[status]}</div>
          {#if waiting}
            <div class="detail">Starts once the wallet has caught up</div>
          {:else if ui.client.detail}
            <div class="detail">{ui.client.detail}</div>
          {/if}
        </div>
      </div>
      <div class="actions">
        {#if active}
          <button class="btn danger" onclick={stopClient} disabled={status === 'stopping'}>
            {status === 'stopping' ? 'Stopping…' : 'Stop client'}
          </button>
        {:else}
          {#if waiting}
            <button class="btn" onclick={() => (ui.startWhenWalletSynced = false)}>Cancel start</button>
          {:else}
            <button class="btn primary" onclick={requestStartClient} disabled={!ready}>Start client</button>
          {/if}
          <button
            class="btn"
            onclick={() => startClient(true)}
            disabled={!ready}
            title="Mine at your chosen difficulty with no transactions sent: nothing is committed, proven or paid"
          >
            Test mining
          </button>
        {/if}
        <button class="btn" onclick={openLithosPanel} disabled={!running}>Lithos panel ↗</button>
      </div>
    </div>

    {#if alert}
      <div class="alert {alert.tone}" role="alert">
        <span class="alert-mark" aria-hidden="true">!</span>
        <div class="alert-body">
          <strong>{alert.title}</strong>
          <span>{alert.text}</span>
        </div>
        {#if alert.action}
          <button class="btn small" onclick={alert.action.run}>{alert.action.label}</button>
        {/if}
      </div>
    {/if}

    {#if running}
      <div class="tiles">
        <div class="tile">
          <span class="tile-name"><span class="swatch you" aria-hidden="true"></span>Your hashrate</span>
          <span class="tile-value num">
            {#if hashrate}{hashrate[0]}<span class="unit you">{hashrate[1]}</span>{:else}—{/if}
          </span>
          <span class="tile-sub">
            {stats?.rigs ?? 0} rig{stats?.rigs === 1 ? '' : 's'} connected ·
            <button class="link" onclick={() => (ui.dialog = 'miner')}>Connect a miner</button>
          </span>
        </div>
        <div class="tile">
          <span class="tile-name"><span class="swatch lithos" aria-hidden="true"></span>Super shares</span>
          <span class="tile-value num"><span class="grad-word">{stats?.superShares ?? 0}</span></span>
          <span class="tile-sub">
            {stats?.superSharesPerHour ? `${stats.superSharesPerHour.toFixed(1)} per hour` : 'this session'}
          </span>
        </div>
        <div class="tile">
          <span class="tile-name"><span class="swatch network" aria-hidden="true"></span>Commitment</span>
          <span class="tile-value num">{commitment.value}</span>
          <span class="tile-sub" class:ok={commitment.ok} class:warn={!commitment.ok && !unpaid} class:bad={unpaid}>
            {commitment.text} ·
            <button class="link" onclick={() => (ui.dialog = 'commit')}>
              {settings?.autoCommit ? 'Details' : 'Commit…'}
            </button>
          </span>
        </div>
      </div>
    {/if}

    <div class="chips">
      <div class="chip">
        <span class="micro">Difficulty</span>
        <span class="val num">{settings?.diff ?? 'not set'}</span>
        <button class="link micro" onclick={() => (ui.dialog = 'difficulty')}>{settings?.diff ? 'Change' : 'Choose'}</button>
      </div>
      <div class="chip">
        <span class="micro">Share reporting</span>
        <span class="val num">{(settings?.reductionMultiplier ?? DEFAULT_REDUCTION_MULTIPLIER).toLocaleString('en-US')}×</span>
        <button class="link micro" onclick={() => (ui.dialog = 'shares')}>Adjust</button>
      </div>
      {#if !running}
        <div class="chip" title={commitmentSource}>
          <span class="micro">Commitment</span>
          {#if commitment.value !== '—'}<span class="val num">{commitment.value}</span>{/if}
          <span class="val" class:ok={commitment.ok} class:warn={!commitment.ok && !unpaid} class:bad={unpaid}>
            {commitment.text}
          </span>
          <button class="link micro" onclick={() => (ui.dialog = 'commit')}>
            {settings?.autoCommit ? 'Details' : 'Commit…'}
          </button>
        </div>
      {/if}
    </div>

    {#if running && stratumUrl}
      <div class="endpoint well">
        <span class="micro">Stratum</span>
        <code class="mono" title={ui.lanAddresses.join(', ')}>{stratumUrl}</code>
        <button class="btn small" onclick={() => copy(stratumUrl!)}>{copied === stratumUrl ? 'Copied' : 'Copy'}</button>
      </div>
      {#if lanPanelUrl}
        <div class="endpoint well">
          <span class="micro">Panel on LAN</span>
          <code class="mono lan">{lanPanelUrl}</code>
          <button class="btn small" onclick={() => copy(lanPanelUrl!)}>{copied === lanPanelUrl ? 'Copied' : 'Copy'}</button>
        </div>
      {/if}
      <div class="endpoint well" title="Copied without being shown. The clipboard clears itself after 30 seconds.">
        <span class="micro">API key</span>
        <span class="secret">
          <span class="dots mono" aria-hidden="true">••••••••••••</span>
          <span class="for">for the panel's DEX and collateral market</span>
        </span>
        <button class="btn small" onclick={copyKey}>{keyCopied ? 'Copied' : 'Copy'}</button>
      </div>
    {:else if !active}
      <RetiredNotice id="client" />
      <ul class="reqs" aria-label="Requirements">
        {#each requirements as r (r.label)}
          <li class:ok={r.ok}>
            <span class="tick" aria-hidden="true">{r.ok ? '✓' : ''}</span>
            {r.label}
            {#if r.note}<span class="req-note">{r.note}</span>{/if}
            <span class="sr-only">{r.ok ? 'done' : 'not yet'}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if warnings.length}
      <ul class="warnings warn-note">
        {#each warnings as w (w)}<li>{w}</li>{/each}
      </ul>
    {/if}
  </div>

  {#if ui.clientError && ui.clientError !== ui.client.detail}
    <p class="error-text client-error" role="alert">{ui.clientError}</p>
  {/if}
</section>

<style>
  .head-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .check.small {
    font-size: 11.5px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px 18px;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    flex-wrap: wrap;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .status-text {
    color: var(--text-head);
    font-family: var(--display);
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }

  .detail {
    margin-top: 2px;
    color: var(--muted);
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  /* Live figures as Mining-page stat tiles, each marked with its colour role. */
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--well);
  }

  .tile-name {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .tile-name .swatch {
    width: 8px;
    height: 8px;
    box-shadow: none;
  }

  .tile-value {
    color: var(--text-head);
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.05;
    white-space: nowrap;
  }

  .unit {
    margin-left: 4px;
    font-size: 0.45em;
    font-weight: 600;
    letter-spacing: 0;
  }

  .unit.you {
    color: var(--amber-light);
  }

  .tile-sub {
    color: var(--faint);
    font-size: 11px;
    line-height: 1.45;
  }

  .tile-sub .link {
    font-size: 11px;
  }

  .ok {
    color: var(--mint);
  }

  .warn {
    color: var(--amber-light);
  }

  .bad,
  .val.bad {
    color: var(--red-light);
  }

  /* Louder than the warning list: these two mean the mining earns nothing. */
  .alert {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px 14px;
    padding: 12px 14px;
    border: 1px solid;
    border-radius: 12px;
  }

  .alert.red {
    border-color: rgba(239, 68, 68, 0.5);
    background: rgba(239, 68, 68, 0.1);
    color: var(--red-light);
  }

  .alert.amber {
    border-color: rgba(251, 191, 36, 0.45);
    background: rgba(251, 191, 36, 0.09);
    color: var(--amber-light);
  }

  .alert-mark {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: #060913;
    font-family: var(--display);
    font-weight: 800;
  }

  .red .alert-mark {
    background: var(--red);
  }

  .amber .alert-mark {
    background: var(--amber);
  }

  .alert-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .alert-body strong {
    color: var(--text-head);
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 10px;
    border: 1px solid rgba(125, 211, 252, 0.12);
    border-radius: var(--radius-sm);
    background: rgba(10, 15, 30, 0.6);
    font-size: 12px;
  }

  .chip .micro {
    font-size: 9.5px;
  }

  .val {
    color: var(--text-head);
    font-weight: 600;
  }

  .val.ok {
    color: var(--mint);
  }

  .val.warn {
    color: var(--amber-light);
  }

  .reqs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--dim);
    font-size: 12px;
  }

  .reqs li {
    display: flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
  }

  .reqs li.ok {
    color: var(--text);
  }

  .tick {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    color: #04111f;
    font-size: 10px;
    font-weight: 700;
  }

  .ok .tick {
    border-color: var(--mint);
    background: var(--mint);
  }

  .req-note {
    color: var(--amber);
    font-family: var(--mono);
    font-size: 10.5px;
  }

  .endpoint {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 7px 8px 7px 12px;
  }

  code {
    overflow: hidden;
    color: var(--sky-light);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  code.lan {
    color: var(--purple-light);
  }

  .secret {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .dots {
    color: var(--purple-light);
    font-size: 12.5px;
    letter-spacing: 0.1em;
  }

  .for {
    overflow: hidden;
    color: var(--faint);
    font-size: 11.5px;
    text-overflow: ellipsis;
  }

  .warnings {
    padding-left: 28px;
  }

  .warnings li + li {
    margin-top: 2px;
  }

  .client-error {
    margin: 0 20px 18px;
  }
</style>
