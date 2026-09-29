<script lang="ts">
  /** A progress ring like the Mining page's epoch ring. `value` is 0..1, or null when unknown. */
  let {
    value,
    caption,
    size = 68,
    done = false
  }: { value: number | null; caption: string; size?: number; done?: boolean } = $props()

  const R = 42
  const C = 2 * Math.PI * R
  const fraction = $derived(value === null ? 0 : Math.min(1, Math.max(0, value)))
  // Whole percent, but never round a nearly finished stage up to 100.
  const pct = $derived(value === null ? '—' : `${fraction >= 1 ? 100 : Math.min(99, Math.floor(fraction * 100))}`)
</script>

<div class="ring" class:done style:width="{size}px" style:height="{size}px" role="img" aria-label="{caption} {pct}%">
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0ea5e9" />
        <stop offset="1" stop-color="#7dd3fc" />
      </linearGradient>
    </defs>
    <circle class="track" cx="50" cy="50" r={R} />
    <circle
      class="arc"
      cx="50"
      cy="50"
      r={R}
      stroke-dasharray="{C * fraction} {C}"
      transform="rotate(-90 50 50)"
    />
  </svg>
  <div class="core">
    <span class="value num">{pct}<small>{value === null ? '' : '%'}</small></span>
    <span class="caption">{caption}</span>
  </div>
</div>

<style>
  .ring {
    position: relative;
    flex: none;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  circle {
    fill: none;
    stroke-width: 7;
  }

  .track {
    stroke: rgba(125, 211, 252, 0.09);
  }

  .arc {
    stroke: url(#ring-grad);
    stroke-linecap: round;
    filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.5));
    transition: stroke-dasharray 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .done .arc {
    stroke: var(--mint);
    filter: drop-shadow(0 0 4px rgba(110, 231, 183, 0.5));
  }

  .core {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .value {
    color: var(--text-head);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1;
  }

  small {
    margin-left: 1px;
    color: var(--sky-light);
    font-size: 0.6em;
    font-weight: 600;
  }

  .done small {
    color: var(--mint);
  }

  .caption {
    margin-top: 3px;
    color: var(--dim);
    font-family: var(--mono);
    font-size: 8px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
