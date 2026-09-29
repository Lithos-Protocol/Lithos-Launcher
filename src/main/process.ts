import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import type { LogChunk, ProcId, ProcState } from '@shared/types'

const LOG_CAPACITY = 5000
const MAX_LINE = 4000
const FLUSH_MS = 100

/** Fixed-size line buffer. Line numbers (sequence) keep counting as old lines drop off. */
class LogBuffer {
  private lines: string[] = []
  private start = 0

  get nextSeq(): number {
    return this.start + this.lines.length
  }

  push(batch: string[]): void {
    for (const line of batch) this.lines.push(line)
    const over = this.lines.length - LOG_CAPACITY
    if (over > 0) {
      this.lines.splice(0, over)
      this.start += over
    }
  }

  snapshot(proc: ProcId): LogChunk {
    return { proc, start: this.start, lines: [...this.lines] }
  }
}

export interface SpawnSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

/**
 * One child process with batched, capped log output.
 * Events: 'state' (ProcState), 'logs' (LogChunk), 'exit' (code: number | null).
 */
export class ManagedProcess extends EventEmitter {
  private child: ChildProcess | null = null
  private current: ProcState
  private readonly logs = new LogBuffer()
  private pending: string[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private redactions: string[] = []

  constructor(readonly id: ProcId) {
    super()
    this.current = { id, network: null, status: 'stopped', pid: null, exitCode: null, detail: null, ports: null }
  }

  /**
   * Secrets to mask if they ever appear in this process's output. Very short values
   * are skipped: masking them would mangle ordinary log text.
   */
  setRedactions(secrets: string[]): void {
    this.redactions = secrets.filter((s) => s.length >= 8)
  }

  get state(): ProcState {
    return this.current
  }

  get alive(): boolean {
    return this.child !== null
  }

  setState(patch: Partial<ProcState>): void {
    this.current = { ...this.current, ...patch }
    this.emit('state', this.current)
  }

  snapshot(): LogChunk {
    this.flush()
    return this.logs.snapshot(this.id)
  }

  /** Adds a launcher message to this process's log. */
  log(message: string): void {
    this.append([`[launcher] ${message}`])
  }

  spawn(spec: SpawnSpec): void {
    if (this.child) throw new Error(`${this.id} is already running`)
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    this.setState({ pid: child.pid ?? null, exitCode: null })
    if (child.stdout) this.attach(child.stdout)
    if (child.stderr) this.attach(child.stderr)

    let exited = false
    const onExit = (code: number | null): void => {
      if (exited) return
      exited = true
      this.flush()
      this.child = null
      this.emit('exit', code)
    }
    child.once('error', (err) => {
      this.log(`Process error: ${err.message}`)
      if (child.pid === undefined) onExit(null) // never started
    })
    // 'close' fires after stdout/stderr are drained, so no output is lost.
    child.once('close', (code) => onExit(code))
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.child?.kill(signal)
  }

  /** Resolves true once the process has exited, or false after `ms`. */
  waitForExit(ms: number): Promise<boolean> {
    if (!this.child) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off('exit', onExit)
        resolve(false)
      }, ms)
      const onExit = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      this.once('exit', onExit)
    })
  }

  private attach(stream: Readable): void {
    const decoder = new StringDecoder('utf8')
    let carry = ''
    stream.on('data', (buf: Buffer) => {
      const parts = (carry + decoder.write(buf)).split(/\r?\n/)
      carry = parts.pop() ?? ''
      if (carry.length > MAX_LINE) {
        parts.push(carry)
        carry = ''
      }
      if (parts.length) this.append(parts)
    })
    stream.on('end', () => {
      const rest = carry + decoder.end()
      if (rest) this.append([rest])
    })
  }

  private append(lines: string[]): void {
    for (let line of lines) {
      // Whitespace-only lines carry nothing (the client's log pattern emits one after every entry).
      if (!line.trim()) continue
      for (const secret of this.redactions) {
        if (line.includes(secret)) line = line.split(secret).join('••••••')
      }
      this.pending.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)} …` : line)
    }
    if (this.pending.length > LOG_CAPACITY) this.pending.splice(0, this.pending.length - LOG_CAPACITY)
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.pending.length) return
    const chunk: LogChunk = { proc: this.id, start: this.logs.nextSeq, lines: this.pending }
    this.pending = []
    this.logs.push(chunk.lines)
    this.emit('logs', chunk)
  }
}
