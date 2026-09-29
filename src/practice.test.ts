import { expect, test } from 'bun:test'
import { practiceRaceId, practiceSeed } from './practice.ts'
import { makeSeed } from './race/core/rng.ts'

test('a well-formed forced seed wins, anything else falls back to local entropy', () => {
  expect(practiceSeed('0xdeadbeef01', 7)).toBe('0xdeadbeef01')
  expect(practiceSeed(null, 7)).toBe(makeSeed(7))
  expect(practiceSeed('0x12', 7)).toBe(makeSeed(7))
  expect(practiceSeed('deadbeef01', 7)).toBe(makeSeed(7))
})

test('local race ids never look like transaction hashes and do not repeat', () => {
  const a = practiceRaceId(1_700_000_000_000, 0)
  const b = practiceRaceId(1_700_000_000_000, 1)
  expect(a.startsWith('local-')).toBe(true)
  expect(a).not.toBe(b)
})
