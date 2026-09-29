<script lang="ts">
  import { onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import type { LogChunk, ProcId } from '@shared/types'

  let {
    proc,
    visible,
    onlines
  }: { proc: ProcId; visible: boolean; onlines?: (count: number) => void } = $props()

  let host: HTMLDivElement
  let fit: FitAddon | null = null

  const SKY = '\x1b[38;2;56;189;248m'
  const AMBER = '\x1b[38;2;245;158;11m'
  const RED = '\x1b[38;2;239;68;68m'
  const RESET = '\x1b[0m'

  /** Highlights launcher messages, warnings and errors in otherwise plain log lines. */
  function colorize(line: string): string {
    if (line.includes('\x1b[')) return line
    if (line.startsWith('[launcher]')) return SKY + line + RESET
    if (/\bERROR\b/.test(line)) return RED + line + RESET
    if (/\bWARN\b/.test(line)) return AMBER + line + RESET
    return line
  }

  onMount(() => {
    let disposed = false
    let term: Terminal | null = null
    let nextSeq = 0
    let total = 0
    let ready = false
    const queued: LogChunk[] = []

    // Sequence numbers let the snapshot and live chunks overlap without duplicating lines.
    const write = (chunk: LogChunk): void => {
      if (!term) return
      const skip = nextSeq - chunk.start
      if (skip >= chunk.lines.length) return
      const lines = skip > 0 ? chunk.lines.slice(skip) : chunk.lines
      nextSeq = chunk.start + chunk.lines.length
      total += lines.length
      term.write(lines.map(colorize).join('\r\n') + '\r\n')
      onlines?.(total)
    }

    const unsubscribe = window.lithos.onLogs((chunk) => {
      if (chunk.proc !== proc) return
      if (ready) write(chunk)
      else queued.push(chunk)
    })

    const observer = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit?.fit()
    })

    // Wait for the mono font so xterm measures character cells correctly.
    void document.fonts.load('12px "JetBrains Mono"').finally(async () => {
      if (disposed) return
      term = new Terminal({
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: 'bar',
        cursorInactiveStyle: 'none',
        scrollback: 3000,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.3,
        theme: {
          background: '#070b16',
          foreground: '#cbd5e1',
          cursor: '#070b16',
          selectionBackground: 'rgba(56, 189, 248, 0.25)',
          scrollbarSliderBackground: 'rgba(56, 189, 248, 0.15)',
          scrollbarSliderHoverBackground: 'rgba(56, 189, 248, 0.3)',
          scrollbarSliderActiveBackground: 'rgba(56, 189, 248, 0.4)'
        }
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      fit.fit()
      observer.observe(host)

      write(await window.lithos.getLogs(proc))
      ready = true
      for (const chunk of queued) write(chunk)
      queued.length = 0
    })

    return () => {
      disposed = true
      unsubscribe()
      observer.disconnect()
      term?.dispose()
    }
  })

  $effect(() => {
    if (visible) requestAnimationFrame(() => fit?.fit())
  })
</script>

<div class="term" class:hidden={!visible} bind:this={host}></div>

<style>
  .term {
    position: absolute;
    inset: 12px 0 12px 16px;
  }

  .hidden {
    display: none;
  }

  .term :global(.xterm-viewport) {
    background: transparent !important;
  }
</style>
