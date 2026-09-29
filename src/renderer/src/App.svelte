<script lang="ts">
  import { onMount } from 'svelte'
  import cube from './assets/cube.svg'
  import ClientCard from './lib/ClientCard.svelte'
  import CommitDialog from './lib/CommitDialog.svelte'
  import DifficultyDialog from './lib/DifficultyDialog.svelte'
  import ImportDialog from './lib/ImportDialog.svelte'
  import LogPanel from './lib/LogPanel.svelte'
  import MinerDialog from './lib/MinerDialog.svelte'
  import NetworkSwitch from './lib/NetworkSwitch.svelte'
  import NodeCard from './lib/NodeCard.svelte'
  import QuickSetup from './lib/QuickSetup.svelte'
  import SettingsDialog from './lib/SettingsDialog.svelte'
  import ShareDialog from './lib/ShareDialog.svelte'
  import SetupCard from './lib/SetupCard.svelte'
  import WalletCard from './lib/WalletCard.svelte'
  import WalletWizard from './lib/WalletWizard.svelte'
  import { clientRequirements, init, startClient, ui } from './lib/store.svelte'

  let loadError = $state<string | null>(null)

  onMount(() => {
    init().catch((err: unknown) => (loadError = err instanceof Error ? err.message : String(err)))
  })

  const nodeUp = $derived(ui.node.status === 'running')

  // Start the client by itself once everything it needs is ready: at most once per node run,
  // and never after a crash or after the user stopped it.
  let autoStartedFor: number | null = null
  $effect(() => {
    const nodePid = ui.node.status === 'running' ? ui.node.pid : null
    if (nodePid === null) {
      autoStartedFor = null
      return
    }
    const ready = clientRequirements().every((r) => r.ok)
    if (ui.autoStartClient && ready && ui.client.status === 'stopped' && autoStartedFor !== nodePid) {
      autoStartedFor = nodePid
      void startClient()
    }
  })
</script>

<div class="app">
  <div class="hairline" aria-hidden="true"></div>

  <header class="topbar">
    <div class="brand">
      <img class="cube" class:alive={nodeUp} src={cube} alt="" width="40" height="40" />
      <div>
        <h1>Lithos Launcher</h1>
        <div class="micro">Ergo node · Lithos Client</div>
      </div>
    </div>

    <NetworkSwitch disabled={ui.installing} />

    <div class="spacer"></div>

    {#if ui.vault}
      <div
        class="keys micro"
        class:warn={!ui.vault.secure}
        title={ui.vault.secure
          ? `Keys are encrypted by your operating system (${ui.vault.backend}).`
          : 'No system keyring found. Keys are kept in memory for this session only.'}
      >
        <span class="square" aria-hidden="true"></span>
        {ui.vault.secure ? 'Keys · OS encrypted' : 'Keys · Session only'}
      </div>
    {/if}
    <button class="gear" onclick={() => (ui.dialog = 'settings')} aria-label="Settings" title="Settings">⚙</button>
  </header>

  {#if loadError}
    <p class="error-text load-error" role="alert">{loadError}</p>
  {/if}

  <main>
    <div class="side">
      <SetupCard />
      <NodeCard />
      <WalletCard />
    </div>
    <div class="main-col">
      <ClientCard />
      <LogPanel />
    </div>
  </main>
</div>

{#if ui.quickSetup}
  <QuickSetup />
{/if}

{#if ui.dialog === 'difficulty'}
  <DifficultyDialog />
{:else if ui.dialog === 'commit'}
  <CommitDialog />
{:else if ui.dialog === 'miner'}
  <MinerDialog />
{:else if ui.dialog === 'shares'}
  <ShareDialog />
{:else if ui.dialog === 'settings'}
  <SettingsDialog />
{:else if ui.dialog === 'import'}
  <ImportDialog />
{/if}

{#if ui.wizard}
  <WalletWizard />
{/if}

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .hairline {
    flex: none;
    height: 3px;
    background: var(--brand);
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 32px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    background: rgba(6, 9, 19, 0.55);
    backdrop-filter: blur(8px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  h1 {
    margin: 0;
    color: var(--text-head);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 3px;
    text-transform: uppercase;
  }

  .cube {
    filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.35));
    animation: float 6s ease-in-out infinite;
  }

  .cube.alive {
    animation:
      float 6s ease-in-out infinite,
      beam 2.4s ease-in-out infinite;
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-3px) rotate(2deg);
    }
  }

  @keyframes beam {
    0%,
    100% {
      filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.35));
    }
    50% {
      filter: drop-shadow(0 0 18px rgba(168, 85, 247, 0.75));
    }
  }

  .spacer {
    flex: 1;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    cursor: default;
  }

  .square {
    width: 8px;
    height: 8px;
    background: var(--green);
  }

  .keys.warn .square {
    background: var(--amber);
  }

  .gear {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--muted);
    font-size: 17px;
    cursor: pointer;
  }

  .gear:hover {
    border-color: rgba(56, 189, 248, 0.45);
    color: var(--text-head);
  }

  .load-error {
    margin: 16px 24px 0;
  }

  main {
    flex: 1;
    display: grid;
    grid-template-columns: 400px minmax(0, 1fr);
    gap: 24px;
    min-height: 0;
    padding: 24px;
  }

  .main-col {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
    min-height: 0;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-height: 0;
    overflow-y: auto;
  }
</style>
