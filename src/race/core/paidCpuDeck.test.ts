import { expect, test } from 'bun:test'
import { PAID_CARD_POOL } from '../cards/paidCards.ts'
import { CPU_CARD_MASK, derivePaidCpuDeck } from './paidCpuDeck.ts'

const SEED = `0x${'11'.repeat(32)}` as const
const ANCHOR = `0x${'22'.repeat(32)}` as const

test('CPU card subset matches the frozen card definitions', () => {
  const source = PAID_CARD_POOL.reduce((bits, card) => card.cpuUsable
    ? bits | (1n << BigInt(Number(card.cardId.slice(2)) - 1)) : bits, 0n)
  expect(CPU_CARD_MASK).toBe(source)
})

test('each CPU horse gets three unique private cards from its own entropy domain', () => {
  expect(derivePaidCpuDeck(SEED, ANCHOR, 0)).toEqual([8, 30, 2])
  expect(derivePaidCpuDeck(SEED, ANCHOR, 1)).toEqual([23, 1, 40])
  for (let horse = 0; horse < 5; horse++) {
    const deck = derivePaidCpuDeck(SEED, ANCHOR, horse)
    expect(new Set(deck).size).toBe(3)
    expect(deck.every((id) => (CPU_CARD_MASK & (1n << BigInt(id - 1))) !== 0n)).toBe(true)
  }
})
