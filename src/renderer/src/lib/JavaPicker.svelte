<script lang="ts">
  import type { JavaList } from '@shared/types'
  import { fmtMB } from './format'
  import ProgressBar from './ProgressBar.svelte'
  import { ui, useJava } from './store.svelte'

  let { list }: { list: JavaList } = $props()

  let picked = $state<number | null>(null)
  let result = $state<{ ok: boolean; text: string } | null>(null)

  const nodeRunning = $derived(ui.node.status === 'running')
  const clientRunning = $derived(ui.client.status === 'running')
  const switching = $derived(ui.switching === 'java')

  const selected = $derived(
    picked !== null && list.releases.some((r) => r.major === picked) ? picked : list.active
  )
  const release = $derived(list.releases.find((r) => r.major === selected) ?? null)
  /** Same line as in use: the button updates it to the newest build. */
  const isUpdate = $derived(selected === list.active && list.update !== null)
  const canSwitch = $derived(
    release !== null &&
      (selected !== list.active || isUpdate || list.installed === null) &&
      ui.switching === null &&
      !ui.installing
  )

  const date = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  function optionText(major: number, version: string): string {
    const tags = [
      major === list.active ? 'in use' : null,
      major === list.defaultMajor ? 'default' : null
    ].filter(Boolean)
    return `Java ${major}${tags.length ? ` (${tags.join(', ')})` : ''} · ${version}`
  }

  async function switchTo(): Promise<void> {
    const major = selected
    const updating = isUpdate
    const wasRunning = nodeRunning
    const clientWasRunning = clientRunning
    result = null
    const error = await useJava(major)
    if (error) {
      result = { ok: false, text: error }
      return
    }
    const what = updating ? `Java ${major} is up to date` : `Java ${major} is in use`
    const client = !clientWasRunning
      ? ''
      : ui.autoStartClient
        ? ' The Lithos Client starts again once the node is ready.'
        : ' Start the Lithos Client again when you are ready.'
    result = {
      ok: true,
      text: wasRunning ? `${what}, and the node restarted on it.${client}` : `${what}. The node and client run on it from their next start.`
    }
  }
</script>

<section>
  <div class="head">
    <h3><span class="swatch" aria-hidden="true"></span>Java runtime</h3>
    <button class="link micro" onclick={() => window.lithos.openLink('javaReleases')}>Release notes ↗</button>
  </div>

  <div class="status">
    <span class="chip">
      <span class="micro">In use</span><span class="num">{list.installed ?? 'Not installed'}</span>
    </span>
    {#if list.update}
      <span class="update">Update available: {list.update}</span>
    {:else if list.installed}
      <span class="current">Up to date</span>
    {/if}
  </div>

  <p class="hint">Eclipse Temurin, shared by mainnet and testnet.</p>

  {#if list.releases.length === 0}
    <p class="warn-note">No Java runtimes the launcher can install were found for this computer.</p>
  {:else}
    <div class="pick">
      <div class="field grow">
        <label class="micro" for="version-java">Version</label>
        <select
          id="version-java"
          class="input mono"
          value={selected}
          onchange={(e) => {
            picked = Number(e.currentTarget.value)
            result = null
          }}
          disabled={ui.switching !== null}
        >
          {#each list.releases as r (r.major)}
            <option value={r.major}>{optionText(r.major, r.version)}</option>
          {/each}
        </select>
      </div>
      <button class="btn primary" onclick={switchTo} disabled={!canSwitch}>
        {switching
          ? isUpdate
            ? 'Updating…'
            : 'Switching…'
          : `${isUpdate ? 'Update' : 'Switch'}${nodeRunning ? ' and restart' : ''}`}
      </button>
    </div>

    {#if release}
      <div class="meta mono">
        <span>Published {date(release.publishedAt)}</span>
        <span>{fmtMB(release.size)} MB</span>
      </div>
    {/if}

    {#if switching}
      {@const p = ui.progress.java}
      <div class="progress">
        <ProgressBar
          value={p?.phase === 'downloading' && p.total ? (p.received ?? 0) / p.total : null}
          label="Java download"
          tone="network"
        />
        <span class="micro">
          {#if p?.phase === 'downloading'}
            Downloading {fmtMB(p.received)} / {fmtMB(p.total)} MB
          {:else if p?.phase === 'extracting'}
            Unpacking
          {:else if ui.node.status === 'stopping' || ui.node.status === 'starting'}
            Restarting the node
          {:else}
            Switching
          {/if}
        </span>
      </div>
    {:else if canSwitch && nodeRunning}
      <p class="info-note">
        The node restarts on Java {selected} once it is downloaded.{clientRunning
          ? ` The Lithos Client stops first${ui.autoStartClient ? ' and starts again once the node is ready' : ''}.`
          : ''}
      </p>
    {/if}
  {/if}

  {#if result}
    <p class={result.ok ? 'ok-note' : 'error-text'} role={result.ok ? 'status' : 'alert'}>{result.text}</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: rgba(15, 22, 41, 0.45);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

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
  }

  .chip .micro {
    font-size: 9.5px;
  }

  .update {
    color: var(--amber-light);
    font-size: 12px;
  }

  .current {
    color: var(--mint);
    font-size: 12px;
  }

  .hint {
    margin: 0;
    color: var(--dim);
    font-size: 11.5px;
    line-height: 1.55;
  }

  .pick {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  select.input {
    appearance: auto;
    font-size: 12.5px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    color: var(--dim);
    font-size: 11px;
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
