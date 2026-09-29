<script lang="ts">
  import { onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import VersionPicker from './VersionPicker.svelte'
  import { errorText, loadReleases, ui } from './store.svelte'

  let checking = $state(false)
  let error = $state<string | null>(null)
  let checked = $state(false)

  const busy = $derived(ui.switching !== null)

  async function load(recheck: boolean): Promise<void> {
    checking = true
    error = null
    try {
      await loadReleases(recheck)
      checked = recheck
    } catch (err) {
      error = errorText(err)
    } finally {
      checking = false
    }
  }

  onMount(() => void load(false))

  function close(): void {
    if (!busy) ui.dialog = null
  }
</script>

<Modal labelledby="versions-title" onclose={close} width={640}>
  <div class="content">
    <div class="top">
      <span class="micro">Versions · {ui.network}</span>
      <button class="x" aria-label="Close" onclick={close} disabled={busy}>✕</button>
    </div>
    <h2 id="versions-title">Node and client versions</h2>
    <p class="note">
      The launcher keeps one version of each. Switching downloads the one you pick from GitHub, checks it against its
      published SHA-256, and removes the old one once the new one is in use. Your chain, wallet and settings stay as
      they are.
    </p>

    {#if ui.releases.node && ui.releases.client}
      <VersionPicker list={ui.releases.node} />
      <VersionPicker list={ui.releases.client} />
    {:else if !error}
      <p class="note">Looking up releases…</p>
    {/if}

    {#if error}
      <p class="error-text" role="alert">Couldn't check GitHub for releases: {error}</p>
    {:else if checked && !checking}
      <p class="ok-note" role="status">Checked GitHub just now.</p>
    {/if}

    <div class="footer">
      <button class="btn" onclick={() => load(true)} disabled={checking || busy}>
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
      <button class="btn primary" onclick={close} disabled={busy}>Done</button>
    </div>
  </div>
</Modal>
