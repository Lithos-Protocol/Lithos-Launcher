<script lang="ts">
  import { NETWORKS, type ImportPreview, type Network } from '@shared/types'
  import { fmtBytesGB } from './format'
  import Modal from './Modal.svelte'
  import { errorText, refresh, setNetwork, ui } from './store.svelte'

  const api = window.lithos
  type Step = 'pick' | 'preview' | 'done'

  let step = $state<Step>('pick')
  let network = $state<Network>(ui.network)
  let nodeFolder = $state<string | null>(null)
  let clientFolder = $state<string | null>(null)
  let preview = $state<ImportPreview | null>(null)
  let importClientSettings = $state(true)
  let copyLithosData = $state(true)
  let scrubbed = $state(false)
  let busy = $state(false)
  let error = $state<string | null>(null)

  const nodeRunning = $derived(ui.node.status !== 'stopped' && ui.node.status !== 'crashed' && ui.node.network === network)

  function close(): void {
    if (!busy) ui.dialog = null
  }

  async function guard(action: () => Promise<void>): Promise<void> {
    busy = true
    error = null
    try {
      await action()
    } catch (err) {
      error = errorText(err)
    } finally {
      busy = false
    }
  }

  const pickNode = (): Promise<void> =>
    guard(async () => {
      nodeFolder = (await api.pickFolder('Pick your Ergo node folder (or its .ergo folder)')) ?? nodeFolder
    })
  const pickClient = (): Promise<void> =>
    guard(async () => {
      clientFolder = (await api.pickFolder('Pick your lithos-client folder')) ?? clientFolder
    })

  const inspect = (): Promise<void> =>
    guard(async () => {
      if (!nodeFolder) return
      preview = await api.inspectImport(network, nodeFolder, clientFolder)
      copyLithosData = Boolean(preview.client?.lithosData)
      step = 'preview'
    })

  const apply = (): Promise<void> =>
    guard(async () => {
      await api.applyImport(network, { importClientSettings, copyLithosData })
      await setNetwork(network)
      await refresh()
      step = 'done'
    })

  const scrub = (): Promise<void> =>
    guard(async () => {
      await api.scrubOldSecrets(network)
      scrubbed = true
    })
</script>

<Modal labelledby="import-title" onclose={close} width={660}>
  <div class="content">
    <div class="top">
      <span class="micro">Import existing setup</span>
      <button class="x" aria-label="Close" onclick={close} disabled={busy}>✕</button>
    </div>

    {#if step === 'pick'}
      <h2 id="import-title">Use a node you already have</h2>
      <p class="note">
        The launcher uses your synced chain and wallet where they are, so nothing re-syncs and nothing large is copied.
        It runs the node with its own settings and a new private API key, and asks for your wallet password the first
        time it starts.
      </p>

      <div class="field">
        <span class="micro">Network</span>
        <div class="seg" role="radiogroup" aria-label="Network">
          {#each NETWORKS as n (n)}
            <button role="radio" aria-checked={network === n} class:on={network === n} onclick={() => (network = n)}>
              {n}
            </button>
          {/each}
        </div>
      </div>

      <div class="pickrow">
        <div>
          <span class="micro">Ergo node folder</span>
          <p class="path mono">{nodeFolder ?? 'The folder with your node (or its .ergo folder)'}</p>
        </div>
        <button class="btn small" onclick={pickNode} disabled={busy}>Browse…</button>
      </div>
      <div class="pickrow">
        <div>
          <span class="micro">Lithos Client folder (optional)</span>
          <p class="path mono">{clientFolder ?? 'Your lithos-client folder, to bring over difficulty and ports'}</p>
        </div>
        <button class="btn small" onclick={pickClient} disabled={busy}>Browse…</button>
      </div>

      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      <div class="footer">
        <button class="btn" onclick={close} disabled={busy}>Cancel</button>
        <button class="btn primary" onclick={inspect} disabled={busy || !nodeFolder}>
          {busy ? 'Checking…' : 'Check this setup'}
        </button>
      </div>
    {:else if step === 'preview' && preview}
      <h2 id="import-title">Here's what was found</h2>
      <ul class="facts">
        <li><span class="micro">Chain data</span><span class="mono path">{preview.dataDir}</span></li>
        <li><span class="micro">Size</span><span>{fmtBytesGB(preview.chainBytes)}</span></li>
        <li>
          <span class="micro">Wallet</span>
          <span>{preview.hasWallet ? 'Found. You will be asked for its password when the node starts.' : 'None'}</span>
        </li>
        {#if preview.client}
          <li>
            <span class="micro">Client config</span>
            <span>
              difficulty <b class="mono">{preview.client.diff ?? 'not set'}</b> · auto-commit
              <b class="mono">{preview.client.autoCommit === null ? 'default (off)' : preview.client.autoCommit ? 'on' : 'off'}</b>
              {#if preview.client.stratumPort}· stratum <b class="mono">{preview.client.stratumPort}</b>{/if}
            </span>
          </li>
        {/if}
      </ul>

      {#if preview.warnings.length}
        <ul class="warnings">
          {#each preview.warnings as w (w)}<li>{w}</li>{/each}
        </ul>
      {/if}

      {#if preview.client}
        <label class="check">
          <input type="checkbox" bind:checked={importClientSettings} />
          Bring over the difficulty, auto-commit and port settings
        </label>
        {#if preview.client.lithosData}
          <label class="check">
            <input type="checkbox" bind:checked={copyLithosData} />
            Copy the client's .lithos data ({fmtBytesGB(preview.client.lithosDataBytes)}) so it doesn't re-sync
          </label>
        {/if}
      {/if}

      {#if nodeRunning}<p class="error-text">Stop the {network} node in the launcher first.</p>{/if}
      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      <div class="footer">
        <button class="btn" onclick={() => (step = 'pick')} disabled={busy}>Back</button>
        <button class="btn primary" onclick={apply} disabled={busy || nodeRunning}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
    {:else}
      <h2 id="import-title">Imported</h2>
      <p class="note">
        The {network} node now uses <span class="mono">{preview?.dataDir}</span>. Make sure your old node and client are
        stopped, then start the node from the dashboard.
      </p>
      {#if preview?.client?.plaintextSecrets && !scrubbed}
        <div class="warn-box">
          <p>
            Your old <span class="mono">lithos.conf</span> still holds your node API key and wallet password in plain text.
            The launcher doesn't use that file. Remove them from it?
          </p>
          <p class="note">
            They are replaced with environment-variable references, so the file stays valid. No copy with the plaintext
            values is kept.
          </p>
          <button class="btn small" onclick={scrub} disabled={busy}>Remove plaintext secrets</button>
        </div>
      {:else if scrubbed}
        <p class="ok-note">The plaintext key and password were removed from the old lithos.conf.</p>
      {/if}
      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      <div class="footer"><button class="btn primary" onclick={close} disabled={busy}>Done</button></div>
    {/if}
  </div>
</Modal>

<style>
  .seg {
    display: flex;
    align-self: flex-start;
    border: 1px solid var(--border-strong);
  }

  .seg button {
    padding: 7px 16px;
    border: none;
    background: transparent;
    color: var(--dim);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .seg button.on {
    background: rgba(56, 189, 248, 0.1);
    color: var(--text-head);
  }

  .pickrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    background: var(--bg-deep);
  }

  .path {
    margin: 4px 0 0;
    overflow-wrap: anywhere;
    color: var(--muted);
    font-size: 12px;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    background: var(--bg-deep);
    list-style: none;
    font-size: 12.5px;
  }

  .facts li {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 12px;
  }

  .facts b {
    color: var(--text-head);
    font-weight: 500;
  }

  .warnings {
    margin: 0;
    padding: 8px 12px 8px 28px;
    border-left: 2px solid var(--amber);
    background: rgba(245, 158, 11, 0.07);
    font-size: 12px;
  }

  .warn-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 14px;
    border-left: 2px solid var(--amber);
    background: rgba(245, 158, 11, 0.07);
    font-size: 12.5px;
  }

  .warn-box p {
    margin: 0;
  }

  .ok-note {
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid var(--green);
    background: rgba(16, 185, 129, 0.07);
    font-size: 12px;
  }
</style>
