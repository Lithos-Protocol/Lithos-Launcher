<script lang="ts">
  import { ERGO_DB_LABEL, type ErgoDb, type ProcId, type ReleaseInfo, type ReleaseList } from '@shared/types'
  import { fmtMB } from './format'
  import ProgressBar from './ProgressBar.svelte'
  import { ui, useVersion } from './store.svelte'

  let { list }: { list: ReleaseList } = $props()

  const NAME: Record<ProcId, string> = { node: 'Ergo node', client: 'Lithos Client' }

  interface Group {
    label: string | null
    releases: ReleaseInfo[]
  }

  let picked = $state<string | null>(null)
  let result = $state<{ ok: boolean; text: string } | null>(null)

  const id = $derived(list.id)
  const proc = $derived(id === 'node' ? ui.node : ui.client)
  const runningHere = $derived(proc.status === 'running' && proc.network === list.network)
  const clientRunningHere = $derived(ui.client.status === 'running' && ui.client.network === list.network)
  const switching = $derived(ui.switching === id)

  /** Releases the existing chain data can't be opened by (the node's other database). */
  const blocked = (r: ReleaseInfo): boolean => list.dataDb !== null && r.db !== null && r.db !== list.dataDb

  const activeRelease = $derived(list.releases.find((r) => r.version === list.active) ?? null)
  /** The version in use can't read this node's chain (it was imported from the other kind of node). */
  const mismatch = $derived(activeRelease !== null && blocked(activeRelease))
  const selected = $derived(
    picked !== null && list.releases.some((r) => r.version === picked)
      ? picked
      : (list.update ??
          (mismatch ? null : list.active) ??
          list.releases.find((r) => !blocked(r))?.version ??
          '')
  )
  const release = $derived(list.releases.find((r) => r.version === selected) ?? null)
  const indexOf = (version: string | null): number => list.releases.findIndex((r) => r.version === version)
  const older = $derived(list.active !== null && indexOf(list.active) !== -1 && indexOf(selected) > indexOf(list.active))
  const canSwitch = $derived(
    release !== null && selected !== list.active && !blocked(release) && ui.switching === null && !ui.installing
  )

  const lines = (releases: ReleaseInfo[]): string =>
    [...new Set(releases.map((r) => `${r.version.split('.').slice(0, 2).join('.')}.x`))].join(' / ')

  // The node's releases come in two databases; the one the chain (or the running version) uses goes first.
  const groups: Group[] = $derived.by(() => {
    if (id !== 'node') return [{ label: null, releases: list.releases }]
    const byDb = new Map<ErgoDb | null, ReleaseInfo[]>()
    for (const r of list.releases) byDb.set(r.db, [...(byDb.get(r.db) ?? []), r])
    const home = list.dataDb ?? activeRelease?.db ?? 'leveldb'
    return [...byDb]
      .sort(([a], [b]) => Number(b === home) - Number(a === home))
      .map(([db, releases]) => ({ label: `${db ? ERGO_DB_LABEL[db] : 'Other'} · ${lines(releases)}`, releases }))
  })
  const dbLines = $derived(groups.map((g) => g.label).filter((l) => l !== null))

  const date = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  function optionText(r: ReleaseInfo, group: Group): string {
    const tags = [
      r.version === list.active ? 'in use' : null,
      r === group.releases[0] ? 'newest' : null,
      blocked(r) ? 'needs a fresh sync' : null
    ].filter(Boolean)
    return `${r.version}${tags.length ? ` (${tags.join(', ')})` : ''} · ${date(r.publishedAt)}`
  }

  async function switchTo(): Promise<void> {
    const version = selected
    const wasRunning = runningHere
    const clientWasRunning = clientRunningHere
    result = null
    const error = await useVersion(id, version)
    if (error) {
      result = { ok: false, text: error }
    } else if (id === 'node') {
      const client = !clientWasRunning
        ? ''
        : ui.autoStartClient
          ? ' The Lithos Client starts again once the node is ready.'
          : ' Start the Lithos Client again when you are ready.'
      result = {
        ok: true,
        text: wasRunning
          ? `The node restarted on Ergo ${version}.${client}`
          : `Ergo ${version} is ready. The node runs it the next time it starts.`
      }
    } else {
      result = {
        ok: true,
        text: wasRunning
          ? `The Lithos Client restarted on ${version}.`
          : `Lithos Client ${version} is ready. It runs the next time the client starts.`
      }
    }
  }
</script>

<section>
  <div class="head">
    <h3><span class="swatch {id === 'node' ? 'network' : 'lithos'}" aria-hidden="true"></span>{NAME[id]}</h3>
    <button class="link micro" onclick={() => window.lithos.openLink(id === 'node' ? 'ergoReleases' : 'clientReleases')}>
      Release notes ↗
    </button>
  </div>

  <div class="status">
    <span class="chip"><span class="micro">In use</span><span class="num">{list.active ?? 'Not installed'}</span></span>
    {#if list.update}
      <span class="update">Update available: {list.update}</span>
    {:else if list.active && !mismatch}
      <span class="current">Up to date</span>
    {/if}
  </div>

  {#if id === 'node'}
    {#if list.dataDb && mismatch}
      <p class="warn-note">
        This node's chain is stored in {ERGO_DB_LABEL[list.dataDb]}, which Ergo {list.active} can't read. Switch to a
        {ERGO_DB_LABEL[list.dataDb]} version before starting the node.
      </p>
    {:else if list.dataDb}
      <p class="hint">
        This node's chain is stored in {ERGO_DB_LABEL[list.dataDb]}, so it stays on {ERGO_DB_LABEL[list.dataDb]} releases.
        The other kind can't read it and would have to sync the whole chain again.
      </p>
    {:else if dbLines.length > 1}
      <p class="hint">
        Ergo builds each release twice: {dbLines.join(' and ')}. Both work with Lithos, but a chain can only be read by
        the kind that wrote it, so choose before the node's first sync. If unsure, keep LevelDB.
      </p>
    {/if}
  {:else if list.network === 'testnet'}
    <p class="hint">Testnet builds only (tagged -test).</p>
  {/if}

  {#if list.releases.length === 0}
    <p class="warn-note">No {NAME[id]} releases the launcher can install were found.</p>
  {:else}
    <div class="pick">
      <div class="field grow">
        <label class="micro" for="version-{id}">Version</label>
        <select
          id="version-{id}"
          class="input mono"
          value={selected}
          onchange={(e) => {
            picked = e.currentTarget.value
            result = null
          }}
          disabled={ui.switching !== null}
        >
          {#each groups as group, i (group.label ?? i)}
            {#if group.label}
              <optgroup label={group.label}>
                {#each group.releases as r (r.version)}
                  <option value={r.version} disabled={blocked(r)}>{optionText(r, group)}</option>
                {/each}
              </optgroup>
            {:else}
              {#each group.releases as r (r.version)}
                <option value={r.version}>{optionText(r, group)}</option>
              {/each}
            {/if}
          {/each}
        </select>
      </div>
      <button class="btn primary" onclick={switchTo} disabled={!canSwitch}>
        {switching ? 'Switching…' : runningHere ? 'Switch and restart' : 'Switch'}
      </button>
    </div>

    {#if release}
      <div class="meta mono">
        <span>Published {date(release.publishedAt)}</span>
        <span>{fmtMB(release.size)} MB</span>
        {#if release.db}<span>{ERGO_DB_LABEL[release.db]}</span>{/if}
      </div>
    {/if}

    {#if switching}
      {@const p = ui.progress[id]}
      <div class="progress">
        <ProgressBar
          value={p?.phase === 'downloading' && p.total ? (p.received ?? 0) / p.total : null}
          label="{NAME[id]} download"
          tone={id === 'node' ? 'network' : 'lithos'}
        />
        <span class="micro">
          {#if p?.phase === 'downloading'}
            Downloading {fmtMB(p.received)} / {fmtMB(p.total)} MB
          {:else if p?.phase === 'extracting'}
            Unpacking
          {:else if runningHere || proc.status === 'stopping' || proc.status === 'starting'}
            Restarting the {id === 'node' ? 'node' : 'client'}
          {:else}
            Switching
          {/if}
        </span>
      </div>
    {:else if selected !== list.active && release && !blocked(release)}
      {#if older}
        <p class="warn-note">
          {selected} is older than the version in use. If it can't start with data the newer one wrote, switch back here.
        </p>
      {/if}
      {#if runningHere}
        <p class="info-note">
          {#if id === 'node'}
            The node restarts on {selected}.{clientRunningHere
              ? ` The Lithos Client stops first${ui.autoStartClient ? ' and starts again once the node is ready' : ''}.`
              : ''}
          {:else}
            The Lithos Client restarts on {selected}.
          {/if}
        </p>
      {/if}
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
