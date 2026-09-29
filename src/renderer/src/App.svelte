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
  <header class="topbar">
    <div class="brand">
      <img class="cube" class:alive={nodeUp} src={cube} alt="" width="40" height="40" />
      <div>
        <h1>Lithos<span class="flow-word">Launcher</span></h1>
        <div class="micro">Ergo node · Lithos Client</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="controls">
      <NetworkSwitch disabled={ui.installing} />
      <div class="row">
        {#if ui.vault}
          <div
            class="keys micro"
            class:warn={!ui.vault.secure}
            title={ui.vault.secure
              ? `Keys are encrypted by your operating system (${ui.vault.backend}).`
              : 'No system keyring found. Keys are kept in memory for this session only.'}
          >
            <span class="dot" aria-hidden="true"></span>
            {ui.vault.secure ? 'Keys · OS encrypted' : 'Keys · Session only'}
          </div>
        {/if}
        <button class="btn small gear" onclick={() => (ui.dialog = 'settings')}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
          </svg>
          Settings
        </button>
      </div>
    </div>
  </header>

  {#if loadError}
    <p class="error-text load-error" role="alert">{loadError}</p>
  {/if}

  <main>
    <!-- The frame keeps the column's scrollbar inside a border instead of hanging off the cards. -->
    <div class="side-frame">
      <div class="side">
        <SetupCard />
        <NodeCard />
        <WalletCard />
      </div>
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

  .topbar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 20px 28px 14px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  h1 {
    margin: 0;
    color: var(--text-head);
    font-family: var(--display);
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.05;
  }

  .brand .micro {
    margin-top: 3px;
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

  .controls,
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: default;
  }

  .keys .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--mint);
    box-shadow: 0 0 8px rgba(110, 231, 183, 0.5);
  }

  .keys.warn .dot {
    background: var(--amber);
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
  }

  .gear svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .load-error {
    position: relative;
    margin: 0 24px 12px;
  }

  main {
    position: relative;
    flex: 1;
    display: grid;
    grid-template-columns: 420px minmax(0, 1fr);
    gap: 20px;
    min-height: 0;
    padding: 6px 24px 24px;
  }

  .main-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
    min-height: 0;
  }

  /* A recessed tray for the stacked cards; the scrollbar lives in its right edge. */
  .side-frame {
    display: flex;
    min-height: 0;
    padding: 10px 2px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 26px;
    background: rgba(4, 6, 13, 0.55);
  }

  .side {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
</style>
