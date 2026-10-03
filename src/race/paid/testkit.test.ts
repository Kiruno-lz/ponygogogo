import { expect, test } from 'bun:test'
import { QUIET_DECK } from './testkit.ts'

test('the default unchosen deck uses distinct cards without stale C-22..C-26 fillers', () => {
  expect(QUIET_DECK.length).toBe(14)
  expect(new Set(QUIET_DECK).size).toBe(14)
  expect(QUIET_DECK.some((id) => id >= 22 && id <= 26)).toBe(false)
})
