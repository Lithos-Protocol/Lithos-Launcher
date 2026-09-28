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
    }
  ])

  const allInstalled = $derived(steps.every((s) => s.installed))

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
    <span class="micro" id="setup-title">01 · Setup</span>
    <button class="link micro" onclick={openFolder} title={ui.net?.folder}>Open folder ↗</button>
  </div>

  <ol class="steps">
    {#each steps as step (step.id)}
      {@const p = ui.progress[step.id]}
      {@const active = p && p.phase !== 'done' && p.phase !== 'error'}
      <li class="step" class:done={step.installed} class:active class:failed={p?.phase === 'error'}>
        <span class="marker" aria-hidden="true">{step.installed ? '✓' : ''}</span>
        <div class="body">
          <div class="row">
            <span class="label">{step.label}</span>
            <span class="version mono">{step.installed ? (step.version ?? '') : active ? '' : 'Not installed'}</span>
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
    {#if allInstalled && !ui.installing}
      <div class="ready micro" role="status"><span aria-hidden="true">✓</span> Everything installed</div>
    {:else}
      <button class="btn primary wide" onclick={install} disabled={!ui.net || ui.installing}>
        {ui.installing ? 'Installing…' : 'Install'}
      </button>
    {/if}
  </div>
</section>

<style>
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--sky);
    cursor: pointer;
  }

  .link:hover {
    color: var(--sky-light);
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
    color: #04111f;
    font-size: 12px;
    font-weight: 700;
  }

  .done .marker {
    border-color: var(--green);
    background: var(--green);
  }

  .active .marker {
    border-color: var(--sky);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
    animation: glow 1.2s ease-in-out infinite alternate;
  }

  .failed .marker {
    border-color: var(--red);
  }

  @keyframes glow {
    from {
      background: rgba(56, 189, 248, 0.1);
    }
    to {
      background: rgba(56, 189, 248, 0.45);
    }
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

  .ready {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border: 1px solid rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.08);
    color: #6ee7b7;
  }
</style>
