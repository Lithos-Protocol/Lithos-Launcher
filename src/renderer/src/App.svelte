<script lang="ts">
  import { onMount } from 'svelte'
  import cube from './assets/cube.svg'
  import ClientCard from './lib/ClientCard.svelte'
  import LogPanel from './lib/LogPanel.svelte'
  import NetworkSwitch from './lib/NetworkSwitch.svelte'
  import NodeCard from './lib/NodeCard.svelte'
  import SetupCard from './lib/SetupCard.svelte'
  import WalletCard from './lib/WalletCard.svelte'
  import WalletWizard from './lib/WalletWizard.svelte'
  import { init, ui } from './lib/store.svelte'

  let loadError = $state<string | null>(null)

  onMount(() => {
    init().catch((err: unknown) => (loadError = err instanceof Error ? err.message : String(err)))
  })

  const nodeUp = $derived(ui.node.status === 'running')
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
