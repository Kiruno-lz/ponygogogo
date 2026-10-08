import { expect, test } from 'bun:test'
import { PAID_CARD_POOL } from '../cards/paidCards.ts'
import { PAID_CARD_RULES, PAID_CARD_RULES_HASH, PAID_CPU_MASK, PAID_RARE_MASK, PAID_RULESET_HASH, paidCardRule } from './cardRules.ts'

test('one paid card table covers 40 cards and generates runtime rarity/CPU eligibility', () => {
  expect(PAID_CARD_RULES).toHaveLength(40)
  for (const card of PAID_CARD_POOL) {
    const id = Number(card.cardId.slice(2))
    expect(paidCardRule(id).rare).toBe(card.quality === 'rare')
    expect(paidCardRule(id).cpu).toBe(card.cpuUsable)
  }
  expect(PAID_RARE_MASK).toBe(0x9610120356n)
  expect(PAID_CPU_MASK).toBe(0xbfefe3fae3n)
  expect(PAID_CARD_RULES_HASH).toBe('0xf4d427d2de6ef0c94cfcbf2ff3b9c8550335035ece2c643b122fb37c6bd06f28')
  expect(PAID_RULESET_HASH).toBe('0xeeaa0e4ce206bb23c12366e9b37be8950e8e2af3de6d7f5d69bdabc99cef716a')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', durationMs: 20_000, radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
})
