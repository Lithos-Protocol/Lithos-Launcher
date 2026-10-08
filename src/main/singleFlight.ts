export interface SingleFlight {
  /** Starts a run, or joins the one already going. */
  (): Promise<void>
  /** A run that starts after this call: waits out one already going, then starts (or joins) the next. */
  fresh(): Promise<void>
}

/**
 * Runs `task` at most once at a time: a call while one is running gets that run's promise, and the
 * next call after it settles starts a new one.
 */
export function singleFlight(task: () => Promise<void>): SingleFlight {
  let running: Promise<void> | null = null
  const call = (): Promise<void> => {
    if (running) return running
    const run = task().finally(() => {
      if (running === run) running = null
    })
    running = run
    return run
  }
  return Object.assign(call, {
    async fresh(): Promise<void> {
      if (running) await running.catch(() => undefined)
      return call()
    }
  })
}
