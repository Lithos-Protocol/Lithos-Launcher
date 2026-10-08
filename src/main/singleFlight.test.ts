import assert from 'node:assert/strict'
import { test } from 'node:test'
import { singleFlight } from './singleFlight.ts'

test('overlapping calls share a run, and later calls start a new one', async () => {
  let runs = 0
  let release: () => void = () => undefined
  const read = singleFlight(async () => {
    runs++
    await new Promise<void>((r) => (release = r))
  })
  const a = read()
  const b = read()
  assert.equal(a, b)
  assert.equal(runs, 1)
  release()
  await a
  const c = read()
  assert.notEqual(c, a)
  assert.equal(runs, 2)
  release()
  await c
})

test('fresh() waits out a run already going and starts another', async () => {
  let runs = 0
  let release: () => void = () => undefined
  const read = singleFlight(async () => {
    runs++
    await new Promise<void>((r) => (release = r))
  })
  const first = read()
  const next = read.fresh()
  assert.equal(runs, 1)
  release()
  await first
  await new Promise((r) => setImmediate(r))
  assert.equal(runs, 2)
  release()
  await next
  // Nothing running: fresh() just starts one.
  const third = read.fresh()
  await new Promise((r) => setImmediate(r))
  assert.equal(runs, 3)
  release()
  await third
})

test('a failed run does not block the next one', async () => {
  let runs = 0
  const read = singleFlight(async () => {
    runs++
    if (runs === 1) throw new Error('boom')
  })
  await assert.rejects(read())
  await read()
  assert.equal(runs, 2)
})
