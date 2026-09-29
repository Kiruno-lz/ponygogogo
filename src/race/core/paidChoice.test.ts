import { expect, test } from 'bun:test'
import { consumePaidChoice } from './paidChoice.ts'

const DECK = [9, 24, 15, 12, 23, 21, 25, 16, 11, 18, 20, 10, 5, 2]

test('one refresh replaces only the selected slot and advances the global cursor', () => {
  expect(consumePaidChoice(DECK, 0, [1], 12)).toEqual({ candidates: [9, 12, 15], nextCursor: 4 })
  expect(consumePaidChoice(DECK, 4, [], 23)).toEqual({ candidates: [23, 21, 25], nextCursor: 7 })
})

test('choice must match refreshed candidates and each slot refreshes at most once', () => {
  expect(() => consumePaidChoice(DECK, 0, [1], 24)).toThrow('CARD_NOT_OFFERED')
  expect(() => consumePaidChoice(DECK, 0, [1, 1], 12)).toThrow('INVALID_REFRESH')
  expect(() => consumePaidChoice(DECK, 12, [], 5)).toThrow('DECK_EXHAUSTED')
})
