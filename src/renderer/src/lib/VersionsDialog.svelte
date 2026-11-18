<script lang="ts">
  import { onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import JavaPicker from './JavaPicker.svelte'
  import VersionPicker from './VersionPicker.svelte'
  import { errorText, loadJava, loadReleases, ui } from './store.svelte'

  let checking = $state(false)
  let error = $state<string | null>(null)
  let javaError = $state<string | null>(null)
  let checked = $state(false)

  const busy = $derived(ui.switching !== null)

  async function load(recheck: boolean): Promise<void> {
    checking = true
    error = null
    javaError = null
    await Promise.all([
      loadReleases(recheck).catch((err) => (error = errorText(err))),
      loadJava(recheck).catch((err) => (javaError = errorText(err)))
    ])
    checked = recheck
    checking = false
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
    <h2 id="versions-title">Node, client and Java versions</h2>
    <p class="note">
      The launcher keeps one version of each. Switching downloads the one you pick (from GitHub, or Eclipse Adoptium for Java), checks it against its
      published SHA-256, and removes the old one once the new one is in use. Your chain, wallet and settings stay as
      they are.
    </p>

    {#if ui.releases.node && ui.releases.client}
      <VersionPicker list={ui.releases.node} />
      <VersionPicker list={ui.releases.client} />
    {:else if !error}
      <p class="note">Looking up releases…</p>
    {/if}

    {#if ui.java}
      <JavaPicker list={ui.java} />
    {:else if !javaError}
      <p class="note">Looking up Java runtimes…</p>
    {/if}

    {#if error}
      <p class="error-text" role="alert">Couldn't check GitHub for releases: {error}</p>
    {/if}
    {#if javaError}
      <p class="error-text" role="alert">Couldn't check Adoptium for Java runtimes: {javaError}</p>
    {/if}
    {#if !error && !javaError && checked && !checking}
      <p class="ok-note" role="status">Checked GitHub and Adoptium just now.</p>
    {/if}

    <div class="footer">
      <button class="btn" onclick={() => load(true)} disabled={checking || busy}>
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
      <button class="btn primary" onclick={close} disabled={busy}>Done</button>
    </div>
  </div>
</Modal>
