<script lang="ts">
  import type { ProcStatus } from '@shared/types'

  let { status, size = 10 }: { status: ProcStatus; size?: number } = $props()
</script>

<span class="dot {status}" style:--size="{size}px" aria-hidden="true"></span>

<style>
  .dot {
    position: relative;
    display: inline-block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--dim);
  }

  .running {
    background: var(--green);
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
  }

  .starting,
  .stopping {
    background: var(--amber);
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
  }

  .crashed {
    background: var(--red);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
  }

  .running::after,
  .starting::after,
  .stopping::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: inherit;
    animation: pulse 2s ease-out infinite;
  }

  .starting::after,
  .stopping::after {
    animation-duration: 1.1s;
  }

  @keyframes pulse {
    from {
      transform: scale(1);
      opacity: 0.6;
    }
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }
</style>
