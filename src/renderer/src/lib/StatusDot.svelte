<script lang="ts">
  import type { ProcStatus } from '@shared/types'

  let { status, size = 10 }: { status: ProcStatus; size?: number } = $props()
</script>

<span class="dot {status}" style:--size="{size}px" aria-hidden="true"></span>

<style>
  /*
   * The Mining page's live-ness marker: a lit dot with a halo while running, flat when not. It stays
   * still (no breathing) so an idle launcher doesn't repaint every frame.
   */
  .dot {
    display: inline-block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--faint);
  }

  .running {
    background: var(--mint);
    box-shadow:
      0 0 0 calc(var(--size) * 0.35) rgba(110, 231, 183, 0.18),
      0 0 10px rgba(110, 231, 183, 0.45);
  }

  .starting,
  .stopping {
    background: var(--amber-light);
    box-shadow:
      0 0 0 calc(var(--size) * 0.35) rgba(251, 191, 36, 0.18),
      0 0 10px rgba(251, 191, 36, 0.45);
  }

  .crashed {
    background: var(--red);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
  }
</style>
