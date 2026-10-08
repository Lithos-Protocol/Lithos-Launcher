<script lang="ts">
  import type { TaskId, TaskProgress } from '@shared/types'
  import { fmtMB } from './format'
  import ProgressBar from './ProgressBar.svelte'
  import { install, openFolder, ui } from './store.svelte'

  interface Step {
    id: TaskId
    label: string
    source: string
    installed: boolean
    version: string | null
  }

  const steps: Step[] = $derived([
    {
      id: 'java',
      label: 'Java 11 runtime',
      source: 'Eclipse Temurin · ~45 MB',
      installed: ui.net?.java.installed ?? false,
      version: ui.net?.java.version ?? null
    },
    {
      id: 'node',
      label: 'Ergo node',
      source: 'ergoplatform/ergo · ~80 MB',
      installed: ui.net?.node.installed ?? false,
      version: ui.net?.node.version ?? null
    },
    {
      id: 'client',
      label: 'Lithos Client',
      source: 'Lithos-Protocol/Lithos-Client · ~105 MB',
      installed: ui.net?.client.installed ?? false,
      version: ui.net?.client.version ?? null
    }
  ])

  const allInstalled = $derived(steps.every((s) => s.installed))
  const nodeUpdate = $derived(ui.releases.node?.update ?? null)
  const clientUpdate = $derived(ui.releases.client?.update ?? null)
  const retired = $derived(Boolean(ui.net?.node.retired || ui.net?.client.retired))
  // Once everything is in place the card shrinks to one line to make room for the node and wallet.
  const compact = $derived(allInstalled && !ui.installing && !ui.setupError)

  const PHASE_TEXT: Record<TaskProgress['phase'], string> = {
    resolving: 'Finding latest release',
    downloading: 'Downloading',
    extracting: 'Unpacking',
    done: 'Installed',
    error: 'Failed'
  }

  function progressValue(p: TaskProgress): number | null {
    if (p.phase === 'downloading' && p.total) return (p.received ?? 0) / p.total
    if (p.phase === 'done') return 1
    return null
  }
</script>

<section class="panel" aria-labelledby="setup-title">
  <div class="panel-head">
    <h2 class="card-title" id="setup-title"><span class="swatch" aria-hidden="true"></span>Setup<span class="no">01</span></h2>
    <div class="head-actions">
      <button
        class="btn small"
        onclick={() => (ui.dialog = 'versions')}
        disabled={!ui.net}
        title={retired
          ? 'A version in use is retired'
          : nodeUpdate || clientUpdate
            ? 'An update is available'
            : 'Pick the node and client versions'}
      >
        Versions{#if retired || nodeUpdate || clientUpdate}<span class="dot" aria-label="Update available"></span>{/if}
      </button>
      <button class="btn small" onclick={openFolder} title={ui.net?.folder}>Open folder ↗</button>
    </div>
  </div>

  {#if compact}
    <div class="ready" role="status">
      <span class="tick" aria-hidden="true">✓</span>
      <span class="ready-title">{retired ? 'Installed, update needed' : 'Everything installed'}</span>
      <div class="versions">
        <span class="chip"><span class="micro">Java</span><span class="num">{ui.net?.java.version}</span></span>
        <span class="chip">
          <span class="micro">Ergo</span><span class="num">{ui.net?.node.version}</span>
          {#if ui.net?.node.retired}
            <span class="up">retired</span>
          {:else if nodeUpdate}
            <span class="up" title="Ergo {nodeUpdate} is available">↑ {nodeUpdate}</span>
          {/if}
        </span>
        <span class="chip">
          <span class="micro">Lithos</span><span class="num">{ui.net?.client.version}</span>
          {#if ui.net?.client.retired}
            <span class="up">retired</span>
          {:else if clientUpdate}
            <span class="up" title="Lithos Client {clientUpdate} is available">↑ {clientUpdate}</span>
          {/if}
        </span>
      </div>
    </div>
  {:else}
    <ol class="steps">
      {#each steps as step (step.id)}
        {@const p = ui.progress[step.id]}
        {@const active = p && p.phase !== 'done' && p.phase !== 'error'}
        <li class="step" class:done={step.installed} class:active class:failed={p?.phase === 'error'}>
          <span class="marker" aria-hidden="true">{step.installed ? '✓' : ''}</span>
          <div class="body">
            <div class="row">
              <span class="label">{step.label}</span>
              <span class="version mono">
                {step.installed ? (step.version ?? '') : active ? '' : 'Not installed'}
                {#if step.installed && step.id !== 'java' && ui.releases[step.id]?.update}
                  <span class="up">↑ {ui.releases[step.id]?.update}</span>
                {/if}
              </span>
            </div>
            {#if p && active}
              <ProgressBar value={progressValue(p)} label="{step.label} progress" />
              <div class="row sub mono">
                <span>{PHASE_TEXT[p.phase]}</span>
                {#if p.phase === 'downloading'}
                  <span>{fmtMB(p.received)} / {fmtMB(p.total)} MB</span>
                {/if}
              </div>
            {:else}
              <div class="sub">{step.source}</div>
            {/if}
          </div>
        </li>
      {/each}
    </ol>

    <div class="foot">
      {#if ui.setupError}
        <p class="error-text" role="alert">{ui.setupError}</p>
      {/if}
      <button
        class="btn primary wide"
        onclick={install}
        disabled={!ui.net || allInstalled || ui.installing || ui.switching !== null}
      >
        {ui.installing ? 'Installing…' : 'Install'}
      </button>
    </div>
  {/if}
</section>

<style>
  .ready {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    padding: 0 20px 16px;
  }

  .tick {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: var(--mint);
    color: #04111f;
    font-size: 12px;
    font-weight: 700;
  }

  .ready-title {
    color: var(--text-head);
    font-weight: 600;
  }

  .versions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
  }

  /* Mining-page chip: a small rounded well with a mono label and a figure. */
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 9px;
    border: 1px solid rgba(125, 211, 252, 0.12);
    border-radius: var(--radius-sm);
    background: rgba(10, 15, 30, 0.6);
    color: var(--text-head);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .chip .micro {
    font-size: 9.5px;
  }

  .up {
    color: var(--amber-light);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
  }

  .head-actions {
    display: flex;
    gap: 8px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--amber);
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0 20px;
  }

  .step {
    display: flex;
    gap: 14px;
    padding: 14px 0;
    border-top: 1px solid var(--border);
  }

  .marker {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: #04111f;
    font-size: 12px;
    font-weight: 700;
  }

  .done .marker {
    border-color: var(--mint);
    background: var(--mint);
  }

  .active .marker {
    border-color: var(--sky);
    background: rgba(56, 189, 248, 0.3);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
  }

  .failed .marker {
    border-color: var(--red);
  }

  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .label {
    color: var(--text-head);
    font-weight: 600;
  }

  .version {
    color: var(--muted);
    font-size: 11.5px;
  }

  .sub {
    color: var(--dim);
    font-size: 11.5px;
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px 20px;
    border-top: 1px solid var(--border);
  }

  .wide {
    width: 100%;
  }
</style>
