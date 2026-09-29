<script lang="ts">
  import { onMount } from 'svelte'
  import {
    DEFAULT_OFFLINE_GENERATION,
    DEFAULT_REDUCTION_MULTIPLIER,
    NETWORKS,
    REDUCTION_MULTIPLIERS,
    type LauncherInfo
  } from '@shared/types'
  import Modal from './Modal.svelte'
  import { errorText, refresh, restartClient, saveClientSettings, ui } from './store.svelte'

  const api = window.lithos
  const network = ui.network
  let info = $state<LauncherInfo | null>(null)
  let nodeMb = $state('')
  let clientMb = $state('')
  let offlineGeneration = $state(DEFAULT_OFFLINE_GENERATION[network])
  let httpPort = $state('')
  let stratumPort = $state('')
  let multiplier = $state<number>(DEFAULT_REDUCTION_MULTIPLIER)
  let testMode = $state(false)
  let lanPanel = $state(false)
  let message = $state<string | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)

  const running = $derived(ui.node.status !== 'stopped' && ui.node.status !== 'crashed')
  const nodeRunningHere = $derived(running && ui.node.network === network)
  const clientRunning = $derived(ui.client.status === 'running' && ui.client.network === network)
  // The first address is this computer's main network adapter (virtual ones are listed last).
  const lanUrl = $derived(ui.lanAddresses[0] ? `http://${ui.lanAddresses[0]}:${httpPort || 9000}` : null)

  function loadClientFields(): void {
    const s = ui.clientSettings
    if (!s) return
    httpPort = String(s.httpPort)
    stratumPort = String(s.stratumPort)
    multiplier = s.reductionMultiplier
    testMode = s.forceConfigDiff
    lanPanel = s.lanPanel
  }

  onMount(async () => {
    const [launcher, node] = await Promise.all([api.getLauncherInfo(), api.getNodeSettings(network)])
    info = launcher
    nodeMb = info.heapOverridden.node ? String(info.heap.nodeMb) : ''
    clientMb = info.heapOverridden.client ? String(info.heap.clientMb) : ''
    offlineGeneration = node.offlineGeneration
    loadClientFields()
  })

  async function run(action: () => Promise<string | void>): Promise<void> {
    busy = true
    error = null
    message = null
    try {
      const done = await action()
      if (done) message = done
    } catch (err) {
      error = errorText(err)
    } finally {
      busy = false
    }
  }

  const changeRoot = (): Promise<void> =>
    run(async () => {
      if (!(await api.chooseInstallRoot())) return
    })

  const resetRoot = (): Promise<void> => run(() => api.resetInstallRoot())

  const saveHeap = (): Promise<void> =>
    run(async () => {
      const parse = (v: string): number | null => (v.trim() === '' ? null : Number(v))
      info = await api.setHeap({ nodeMb: parse(nodeMb), clientMb: parse(clientMb) })
      return 'Memory settings saved. They apply the next time the node and client start.'
    })

  const saveNode = (): Promise<void> =>
    run(async () => {
      const saved = await api.setNodeSettings(network, { offlineGeneration })
      offlineGeneration = saved.offlineGeneration
      return nodeRunningHere
        ? 'Saved. Restart the node for it to take effect.'
        : 'Saved. The node uses this the next time it starts.'
    })

  const saveClient = (): Promise<void> =>
    run(async () => {
      const err = await saveClientSettings({
        httpPort: Number(httpPort),
        stratumPort: Number(stratumPort),
        reductionMultiplier: multiplier,
        forceConfigDiff: testMode,
        lanPanel
      })
      if (err) throw new Error(err)
      loadClientFields()
      if (clientRunning) {
        await restartClient()
        return 'Saved, and the client restarted with the new settings.'
      }
      return 'Saved. The client uses these settings the next time it starts.'
    })

  const clearImport = (target: (typeof NETWORKS)[number]): Promise<void> =>
    run(async () => {
      await api.clearImport(target)
      info = await api.getLauncherInfo()
      await refresh()
      return `The ${target} node now uses the launcher's own data folder again.`
    })
</script>

<Modal labelledby="settings-title" onclose={() => !busy && (ui.dialog = null)} width={680}>
  <div class="content">
    <div class="top">
      <span class="micro">Settings</span>
      <button class="x" aria-label="Close" onclick={() => (ui.dialog = null)} disabled={busy}>✕</button>
    </div>
    <h2 id="settings-title">Advanced settings</h2>

    {#if !info}
      <p class="note">Loading…</p>
    {:else}
      <section>
        <h3>Install folder</h3>
        <p class="path mono">{info.root}</p>
        <p class="note">
          Java, the node, the client and their data live here. Changing it restarts the launcher; files already
          installed are not moved.
        </p>
        <div class="row">
          <button class="btn small" onclick={changeRoot} disabled={busy || running}>Change…</button>
          {#if info.root !== info.defaultRoot}
            <button class="btn small" onclick={resetRoot} disabled={busy || running}>Use default</button>
          {/if}
          {#if running}<span class="hint">Stop the node first.</span>{/if}
        </div>
      </section>

      <section>
        <h3>Existing setups</h3>
        {#each NETWORKS as n (n)}
          <div class="kv">
            <span class="micro">{n} node data</span>
            {#if info.dataDirs[n]}
              <span class="mono path">{info.dataDirs[n]} <span class="tag">imported</span></span>
              <button class="link micro" onclick={() => clearImport(n)} disabled={busy}>Stop using it</button>
            {:else}
              <span class="dim">Launcher's own folder</span>
            {/if}
          </div>
        {/each}
        <div class="row">
          <button class="btn small" onclick={() => (ui.dialog = 'import')}>Import an existing setup…</button>
        </div>
      </section>

      <section>
        <h3>Memory</h3>
        <p class="note">Maximum Java heap for each program. Leave empty for automatic, sized from this computer's RAM.</p>
        <div class="grid2">
          <div class="field">
            <label class="micro" for="node-mb">Ergo node (MB)</label>
            <input id="node-mb" class="input mono" placeholder="auto: {info.autoHeap.nodeMb}" bind:value={nodeMb} />
          </div>
          <div class="field">
            <label class="micro" for="client-mb">Lithos Client (MB)</label>
            <input id="client-mb" class="input mono" placeholder="auto: {info.autoHeap.clientMb}" bind:value={clientMb} />
          </div>
        </div>
        <div class="row"><button class="btn small" onclick={saveHeap} disabled={busy}>Save memory</button></div>
      </section>

      <section>
        <h3><span class="swatch network" aria-hidden="true"></span>Ergo node · {network}</h3>
        <label class="check">
          <input type="checkbox" bind:checked={offlineGeneration} />
          Offline generation: hand out mining work right after a restart
        </label>
        <span class="hint">
          The node hands out mining work without first waiting for a new block from the network, so mining resumes
          straight away after a restart. Ergo turns this on by default for mainnet{DEFAULT_OFFLINE_GENERATION[network]
            ? ''
            : ' but not for testnet'}.
        </span>
        <div class="row">
          <button class="btn small" onclick={saveNode} disabled={busy}>Save node settings</button>
        </div>
      </section>

      <section>
        <h3><span class="swatch lithos" aria-hidden="true"></span>Lithos Client · {network}</h3>
        <div class="grid2">
          <div class="field">
            <label class="micro" for="http-port">Panel port</label>
            <input id="http-port" class="input mono" bind:value={httpPort} />
          </div>
          <div class="field">
            <label class="micro" for="stratum-port">Stratum port</label>
            <input id="stratum-port" class="input mono" bind:value={stratumPort} />
          </div>
        </div>
        <div class="field">
          <label class="micro" for="multiplier">Share reporting</label>
          <select id="multiplier" class="input" bind:value={multiplier}>
            {#each REDUCTION_MULTIPLIERS as m (m)}
              <option value={m}>
                {m === 10000 ? 'Super shares only (10,000×)' : `${m.toLocaleString('en-US')}× your difficulty`}{m ===
                DEFAULT_REDUCTION_MULTIPLIER
                  ? ' (default)'
                  : ''}
              </option>
            {/each}
          </select>
          <span class="hint">
            Miners are sent this multiple of your difficulty, so they report fewer shares. Lower it if your miner shows
            too few shares for a steady hashrate. What Lithos pays is unchanged.
          </span>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={lanPanel} />
          Open the Lithos panel to other devices on your network
        </label>
        <span class="hint">
          Lets you check on mining from your phone or another computer on the same Wi-Fi or LAN{lanUrl
            ? `, at ${lanUrl}`
            : ''}. Otherwise the panel only opens on this computer.
        </span>
        {#if lanPanel}
          <p class="warn-note">
            Anyone on your network can open the panel and see its statistics. Actions that spend from the wallet still
            need the client's API key, which the panel sends over plain HTTP, so only enable this on a network you
            trust.{ui.platform === 'win32'
              ? ' If Windows asks whether Java may use the network, allow it on private networks.'
              : ''}
          </p>
        {/if}
        <label class="check">
          <input type="checkbox" bind:checked={testMode} />
          Test mode: mine at the configured difficulty without committing it (forceConfigDiff)
        </label>
        {#if testMode}
          <p class="warn-note">
            Turn this off before mining for real: proofs at a difficulty below your commitment are rejected.
          </p>
        {/if}
        <div class="row">
          <button class="btn small" onclick={saveClient} disabled={busy}>
            {clientRunning ? 'Save and restart client' : 'Save client settings'}
          </button>
        </div>
      </section>
    {/if}

    {#if message}<p class="ok-note" role="status">{message}</p>{/if}
    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <div class="footer"><button class="btn primary" onclick={() => (ui.dialog = null)} disabled={busy}>Done</button></div>
  </div>
</Modal>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: rgba(15, 22, 41, 0.45);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .path {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--sky-light);
    font-size: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .kv {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 12px;
    font-size: 12px;
  }

  .tag {
    margin-left: 6px;
    color: var(--mint);
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
  }

  .dim,
  .hint {
    color: var(--dim);
    font-size: 11.5px;
  }

  select.input {
    appearance: auto;
  }
</style>
