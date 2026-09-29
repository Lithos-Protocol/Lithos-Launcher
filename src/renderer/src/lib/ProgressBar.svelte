<script lang="ts">
  /** `value` is 0..1; null shows an indeterminate shimmer. `tone` follows the colour roles. */
  let {
    value,
    label,
    tone = 'network'
  }: { value: number | null; label: string; tone?: 'network' | 'lithos' | 'you' } = $props()
</script>

<div
  class="track {tone}"
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
  /* A Mining-page rail: thin, rounded, filled in its role's colour. */
  .track {
    position: relative;
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(125, 211, 252, 0.08);
  }

  .fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #0ea5e9, #38bdf8);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.45);
    transition: width 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .lithos .fill {
    background: linear-gradient(90deg, #818cf8, #a855f7);
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.45);
  }

  .you .fill {
    background: linear-gradient(90deg, #f59e0b, #fbbf24);
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);
  }

  .shimmer {
    position: absolute;
    inset: 0;
    width: 40%;
    border-radius: 999px;
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
