<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    labelledby,
    onclose,
    width = 600,
    children
  }: { labelledby: string; onclose?: () => void; width?: number; children: Snippet } = $props()

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && onclose) onclose()
  }

  /** Moves focus into the dialog: the first field, else the main action, else the first button. */
  function focusFirst(node: HTMLElement): void {
    requestAnimationFrame(() =>
      (
        node.querySelector<HTMLElement>('input, textarea') ??
        node.querySelector<HTMLElement>('.btn.primary:not(:disabled)') ??
        node.querySelector<HTMLElement>('button:not(.x)')
      )?.focus()
    )
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay">
  <div
    class="dialog panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledby}
    style:width="min({width}px, 100%)"
    use:focusFirst
  >
    {@render children()}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(6, 9, 19, 0.82);
    backdrop-filter: blur(6px);
  }

  .dialog {
    max-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }

  .dialog :global(.content) {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 28px 28px;
  }

  .dialog :global(.top) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 24px;
  }

  .dialog :global(.x) {
    border: none;
    background: none;
    color: var(--dim);
    font-size: 14px;
    cursor: pointer;
  }

  .dialog :global(.x:hover) {
    color: var(--text-head);
  }

  .dialog :global(h2) {
    margin: 0;
    color: var(--text-head);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .dialog :global(.footer) {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 4px;
  }
</style>
