<script lang="ts">
  /** `value` is 0..1; null shows an indeterminate shimmer. */
  let { value, label }: { value: number | null; label: string } = $props()
</script>

<div
  class="track"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={value === null ? undefined : Math.round(value * 100)}
>
  {#if value === null}
    <div class="shimmer"></div>
  {:else}
    <div class="fill" style:width="{Math.min(100, Math.max(0, value * 100))}%"></div>
  {/if}
</div>

<style>
  .track {
    position: relative;
    height: 4px;
    overflow: hidden;
    background: rgba(56, 189, 248, 0.1);
  }

  .fill {
    height: 100%;
    background: var(--brand);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
    transition: width 0.3s ease-out;
  }

  .shimmer {
    position: absolute;
    inset: 0;
    width: 40%;
    background: linear-gradient(90deg, transparent, var(--sky), var(--purple), transparent);
    animation: slide 1.4s ease-in-out infinite;
  }

  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
</style>
