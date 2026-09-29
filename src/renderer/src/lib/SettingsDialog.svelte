<script lang="ts">
  import { onMount } from 'svelte'
  import {
    DEFAULT_OFFLINE_GENERATION,
    DEFAULT_REDUCTION_MULTIPLIER,
    NETWORKS,
    REDUCTION_MULTIPLIERS,
    type ApiKeyName,
    type ConfigName,
    type LauncherInfo,
    type NetworkConfigInfo
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
  let config = $state<NetworkConfigInfo | null>(null)
  let confirmRotate = $state<ApiKeyName | null>(null)
  let rotating = $state<ApiKeyName | null>(null)
  let message = $state<string | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)

  const KEYS: { name: ApiKeyName; label: string; use: string }[] = [
    {
      name: 'node',
      label: 'Node API key',
      use: 'Unlocks wallet and admin actions in the node panel. The node only accepts it from this computer.'
    },
    {
      name: 'lithos',
      label: 'Lithos API key',
      use: "Lets the Lithos panel claim rewards and place DEX orders. Enter it in the panel's settings."
    }
  ]
  const FILES: { name: ConfigName; file: string; owner: string }[] = [
    { name: 'node', file: 'ergo.conf', owner: 'node' },
    { name: 'client', file: 'lithos.conf', owner: 'client' }
  ]

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

  const loadConfig = async (): Promise<void> => {
    config = await api.getConfigInfo(network)
  }

  onMount(() => {
    void (async () => {
      const [launcher, node] = await Promise.all([api.getLauncherInfo(), api.getNodeSettings(network), loadConfig()])
      info = launcher
      nodeMb = info.heapOverridden.node ? String(info.heap.nodeMb) : ''
      clientMb = info.heapOverridden.client ? String(info.heap.clientMb) : ''
      offlineGeneration = node.offlineGeneration
      loadClientFields()
    })()
    // Coming back from an editor: pick up what changed in the config files.
    const onFocus = (): void => void loadConfig()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
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

  const copyKey = (name: ApiKeyName): Promise<void> =>
    run(async () => {
      await api.copyApiKey(network, name)
      return `Copied the ${name === 'node' ? 'node' : 'Lithos'} API key. The clipboard clears itself in 30 seconds.`
    })

  const rotateKey = (name: ApiKeyName): Promise<void> =>
    run(async () => {
      confirmRotate = null
      rotating = name
      try {
        await api.rotateApiKey(network, name)
      } finally {
        rotating = null
      }
      await loadConfig()
      if (name === 'lithos') {
        return clientRunning
          ? 'New Lithos API key in use; the client restarted with it. Update it wherever you entered the old one.'
          : 'New Lithos API key saved. The client uses it the next time it starts.'
      }
      return ui.autoStartClient
        ? 'The node restarted with its new API key. The Lithos Client starts again once the node is ready.'
        : 'The node restarted with its new API key. Start the Lithos Client again when you are ready.'
    })

  const openConfig = (name: ConfigName, reveal: boolean): Promise<void> => run(() => api.openConfig(network, name, reveal))

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

      <section>
        <h3>API keys · {network}</h3>
        <p class="note">
          Paste a key where a panel asks for one. The launcher copies it without showing it, keeps it out of Windows
          clipboard history, and clears the clipboard again after 30 seconds.
        </p>
        {#each KEYS as k (k.name)}
          <div class="item">
            <div class="item-body">
              <span class="item-name">{k.label}</span>
              <span class="hint">{config?.keys[k.name] ? k.use : `Made the first time the ${k.name === 'node' ? 'node' : 'client'} starts.`}</span>
            </div>
            <div class="row">
              <button class="btn small" onclick={() => copyKey(k.name)} disabled={busy || !config?.keys[k.name]}>Copy</button>
              <button
                class="btn small"
                onclick={() => (confirmRotate = k.name)}
                disabled={busy || !nodeRunningHere || ui.node.status !== 'running'}>New key…</button
              >
            </div>
          </div>
          {#if confirmRotate === k.name}
            <div class="warn-note confirm">
              {#if k.name === 'node'}
                Replace the node API key? The node restarts once{clientRunning
                  ? ', and the Lithos Client stops until the node is back'
                  : ''}. The old key stops working.
              {:else}
                Replace the Lithos API key?{clientRunning ? ' The client restarts.' : ''} The old key stops working, so enter
                the new one wherever you used the old.
              {/if}
              <div class="row">
                <button class="btn small danger" onclick={() => rotateKey(k.name)} disabled={busy}>Replace key</button>
                <button class="btn small" onclick={() => (confirmRotate = null)} disabled={busy}>Cancel</button>
              </div>
            </div>
          {/if}
        {/each}
        {#if !nodeRunningHere || ui.node.status !== 'running'}
          <span class="hint">Start the {network} node to replace a key: the node computes each new key's hash.</span>
        {/if}
        {#if rotating}
          <p class="info-note" role="status">
            {rotating === 'node' ? 'Restarting the node with its new key…' : 'Replacing the Lithos API key…'}
          </p>
        {/if}
      </section>

      <section>
        <h3>Config files · {network}</h3>
        <p class="note">
          The launcher only rewrites the marked block at the top of each file. Add your own settings below it: they are
          kept across restarts and client updates, override the launcher's, and apply the next time the node or client
          starts.
        </p>
        {#each FILES as f (f.name)}
          {@const file = config?.files[f.name]}
          <div class="item">
            <div class="item-body">
              <span class="item-name mono">{f.file}</span>
              <span class="path mono">{file?.exists ? file.path : `Created the first time the ${f.owner} starts.`}</span>
            </div>
            <div class="row">
              <button class="btn small" onclick={() => openConfig(f.name, false)} disabled={busy || !file?.exists}>Open</button>
              <button class="btn small" onclick={() => openConfig(f.name, true)} disabled={busy || !file?.exists}>
                Show in folder
              </button>
            </div>
          </div>
          {#if file?.overrides.length}
            <p class="warn-note">
              Your settings in {f.file} override ones the launcher relies on:
              <span class="mono">{file.overrides.join(', ')}</span>. The {f.owner} may not work as expected{f.name ===
              'client'
                ? ', and the settings above may not be what the client actually uses'
                : ''}.
            </p>
          {/if}
        {/each}
        <span class="hint">
          Don't edit conf/application.conf inside the client's release folder: each client update replaces it.
        </span>
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

  /* A named thing (a key, a file) with its actions on the right. */
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 10px 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--well);
  }

  .item-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .item-name {
    color: var(--text-head);
    font-size: 12.5px;
    font-weight: 600;
  }

  .item .row {
    flex: none;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
