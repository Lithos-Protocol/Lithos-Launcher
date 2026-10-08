import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitError, commitmentOf, legacyCommitmentOf, sentOf } from './commitment.ts'

// Shaped like the client's Play JSON: a None field is left out, not written as null.
const TIMING = {
  servedAfterBlocks: 63,
  inForceAfterBlocks: 125,
  replaceableAfterBlocks: 845,
  windowBlocks: 60,
  rollupLifetimeBlocks: 720
}

test('a first commitment waiting to come into force', () => {
  const read = commitmentOf({
    state: 'waiting',
    height: 1000,
    pending: { score: '4000000000', diff: '4.00G', declaredHeight: 1060, inForceFromHeight: 1120, servedFromHeight: 1058 },
    replaceableFromHeight: 1840,
    canCommit: false,
    blockedReason: 'LOCKED',
    autoCommit: false,
    configDiff: '4G',
    timing: TIMING
  })
  assert.ok(read)
  assert.equal(read.state, 'waiting')
  assert.equal(read.inForce, null)
  assert.deepEqual(read.pending, {
    score: '4000000000',
    declaredHeight: 1060,
    inForceFromHeight: 1120,
    servedFromHeight: 1058
  })
  assert.equal(read.blockedReason, 'LOCKED')
  assert.equal(read.canCommit, false)
  assert.equal(read.timing?.servedAfterBlocks, 63)
  assert.equal(read.api, true)
})

test('a registration in flight', () => {
  const read = commitmentOf({
    state: 'registering',
    reason: 'waiting for the registration to confirm',
    height: 1000,
    inFlight: {
      txId: 'ab'.repeat(32),
      kind: 'registration',
      commitment: { score: '48000000', diff: '48.0M', declaredHeight: 1065, inForceFromHeight: 1125, servedFromHeight: 1063 }
    },
    replaceableFromHeight: 1845,
    canCommit: false,
    blockedReason: 'IN_FLIGHT',
    autoCommit: false,
    configDiff: '48M',
    timing: TIMING
  })
  assert.equal(read?.inFlight?.kind, 'registration')
  assert.equal(read?.inFlight?.confirmedHeight, null)
  assert.equal(read?.inFlight?.commitment.servedFromHeight, 1063)
})

test('anything that is not a status is ignored', () => {
  assert.equal(commitmentOf(null), null)
  assert.equal(commitmentOf({ error: 404, reason: 'Not found' }), null)
  assert.equal(commitmentOf({ state: 'active', inForce: { score: 'abc' } })?.inForce, null)
})

test('an older client reports through /stats', () => {
  assert.equal(legacyCommitmentOf({}, 60), null)
  const read = legacyCommitmentOf({ committed: '1000', pending: '2000', pendingFromHeight: 1120, checkedHeight: 1000 }, 60)
  assert.equal(read?.api, false)
  assert.equal(read?.inForce?.score, '1000')
  assert.equal(read?.pending?.declaredHeight, 1060)
  assert.equal(read?.pending?.inForceFromHeight, 1120)
})

test('errors read as sentences', () => {
  assert.equal(
    commitError(422, { error: 422, reason: 'Cannot be executed', detail: 'the newest commitment cannot be replaced before 1840' }),
    'The newest commitment cannot be replaced before 1840.'
  )
  assert.match(commitError(403, null), /API key/)
  assert.equal(commitError(500, 'oops'), 'The Lithos Client answered HTTP 500.')
})

test('a sent commitment', () => {
  const sent = sentOf(
    {
      txId: 'cd'.repeat(32),
      kind: 'change',
      outcome: 'accepted',
      score: '1',
      diff: '1.00G',
      sentAtHeight: 2000,
      declaredHeight: 2065,
      servedFromHeight: 2063,
      inForceFromHeight: 2125,
      replaceableFromHeight: 2845
    },
    '1G'
  )
  assert.equal(sent.kind, 'change')
  assert.equal(sent.inForceFromHeight, 2125)
  assert.equal(sent.diff, '1.00G')
})
