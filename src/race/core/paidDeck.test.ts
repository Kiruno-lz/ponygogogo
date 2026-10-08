import { expect, test } from 'bun:test'
import { PAID_CARD_POOL } from '../cards/paidCards.ts'
import { derivePaidDeck, FULL_CARD_MASK, RARE_CARD_MASK } from './paidDeck.ts'

const SEED = `0x${'11'.repeat(32)}` as const
const ANCHOR = `0x${'22'.repeat(32)}` as const

test('paid card eligibility and rare subset match the 40-card pool', () => {
  const sourceMask = PAID_CARD_POOL.reduce((bits, card) => card.quality === 'rare'
    ? bits | (1n << BigInt(Number(card.cardId.slice(2)) - 1)) : bits, 0n)
  expect(PAID_CARD_POOL.length).toBe(40)
  expect(PAID_CARD_POOL.filter((card) => card.quality === 'common')).toHaveLength(27)
  expect(RARE_CARD_MASK).toBe(sourceMask)
  const commonOnly = FULL_CARD_MASK & ~RARE_CARD_MASK
  expect(() => derivePaidDeck(SEED, ANCHOR, commonOnly)).toThrow('CARD_POOL_TOO_SMALL')
})

test('paid deck is unique and reserves two eligible rare cards at the tail', () => {
  const deck = derivePaidDeck(SEED, ANCHOR, FULL_CARD_MASK)
  expect(derivePaidDeck(SEED, ANCHOR)).toEqual(deck)
  expect(deck).toHaveLength(14)
  expect(new Set(deck).size).toBe(14)
  expect(deck.slice(12).every((id) => ((RARE_CARD_MASK >> BigInt(id - 1)) & 1n) === 1n)).toBe(true)
  expect(deck).toEqual([20, 34, 13, 33, 11, 15, 26, 6, 19, 3, 18, 37, 35, 10])
  expect(() => derivePaidDeck(SEED, ANCHOR, (1n << 9n) - 1n)).toThrow('CARD_POOL_TOO_SMALL')
})
