import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arbStakeOf, reclaimedOf } from './arb.ts'

const BODY = {
  address: '9fArbAddressExample',
  enabled: true,
  paused: false,
  targetNanoErgs: '10000000000',
  stakeNanoErgs: '10000000000',
  boxes: 2,
  nanoErgs: '10500000000'
}

test('reads GET /wallet/arb, with nanoERG as strings', () => {
  assert.deepEqual(arbStakeOf(BODY), {
    address: '9fArbAddressExample',
    enabled: true,
    paused: false,
    targetNanoErg: 10_000_000_000,
    stakeNanoErg: 10_000_000_000,
    boxes: 2,
    nanoErg: 10_500_000_000
  })
})

test('an empty arb address reads as zero', () => {
  const read = arbStakeOf({ ...BODY, stakeNanoErgs: '0', nanoErgs: '0', boxes: 0, enabled: false })
  assert.equal(read?.stakeNanoErg, 0)
  assert.equal(read?.enabled, false)
})

test('rejects bodies that are not an arb stake', () => {
  assert.equal(arbStakeOf(null), null)
  assert.equal(arbStakeOf({ status: 503, reason: 'Node unavailable' }), null)
  assert.equal(arbStakeOf({ ...BODY, address: '' }), null)
  assert.equal(arbStakeOf({ ...BODY, nanoErgs: '-1' }), null)
  assert.equal(arbStakeOf({ ...BODY, nanoErgs: '99999999999999999999' }), null)
})

test('reads POST /wallet/arb/reclaim', () => {
  assert.deepEqual(
    reclaimedOf({ txId: 'abc', boxes: 2, nanoErgs: '10500000000', outcome: 'accepted', remainingBoxes: 0 }),
    { txId: 'abc', boxes: 2, nanoErg: 10_500_000_000, outcome: 'accepted', remainingBoxes: 0 }
  )
})
