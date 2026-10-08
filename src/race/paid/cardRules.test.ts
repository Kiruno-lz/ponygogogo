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
  expect(PAID_CARD_RULES_HASH).toBe('0x7d0d2ea084231e8f601c85bcb9aa74a116720753d70ab80d36d084ef40c4fce9')
  expect(PAID_RULESET_HASH).toBe('0xbe9522b229a6c54f20e2ad01c31dcc06574d0b204596901c12b95ce6d1c1528c')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', durationMs: 20_000, radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
})
