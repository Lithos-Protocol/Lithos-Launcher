<script lang="ts">
  import type { ProcStatus } from '@shared/types'

  let { status, size = 10 }: { status: ProcStatus; size?: number } = $props()
</script>

<span class="dot {status}" style:--size="{size}px" aria-hidden="true"></span>

<style>
  /* The Mining page's live-ness marker: the dot breathes while running and goes flat when not. */
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
    animation: pulse 2.2s ease-out infinite;
  }

  .starting,
  .stopping {
    --ring: 251, 191, 36;
    background: var(--amber-light);
    animation: pulse 1.2s ease-out infinite;
  }

  .crashed {
    background: var(--red);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(var(--ring, 110, 231, 183), 0.55);
    }
    70% {
      box-shadow: 0 0 0 calc(var(--size) * 0.8) rgba(var(--ring, 110, 231, 183), 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(var(--ring, 110, 231, 183), 0);
    }
  }
</style>
