import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clientRetired, compareLoose, ergoRetired } from './versions.ts'

test('Ergo below 6.0.7 and its RocksDB twin 6.1.7 is retired', () => {
  for (const v of ['6.0.6', '6.1.6', '6.0.3', '5.0.22']) assert.ok(ergoRetired(v), v)
  for (const v of ['6.0.7', '6.1.7', '6.0.10', '6.1.10', '7.0.0']) assert.equal(ergoRetired(v), null, v)
})

test('Lithos Client 1.0.0, 1.0.1 and the mainnet prereleases are retired, others are not', () => {
  assert.ok(clientRetired('1.0.0'))
  assert.ok(clientRetired('1.0.1'))
  for (const v of ['1.0.0-prerelease', '1.0.0-prerelease-hotfix', '1.1.0-prerelease']) assert.ok(clientRetired(v), v)
  for (const v of ['1.0.2', '1.1.0', '5.6.0-test']) assert.equal(clientRetired(v), null, v)
})

test('releases compare by their numeric part', () => {
  assert.ok(compareLoose('1.0.2', '1.0.1') > 0)
  assert.ok(compareLoose('1.0.2', '1.1.0-prerelease') < 0)
  assert.equal(compareLoose('5.6.0-test', '5.6.0'), 0)
})
