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
  expect(PAID_RARE_MASK).toBe(0xf6e232973en)
  expect(PAID_CPU_MASK).toBe(0xbfefe3fae3n)
  expect(PAID_CARD_RULES_HASH).toBe('0xb8351e02bafc73263c6f8c040ab3c53f2dae91e1515e10b0540145d11e07336e')
  expect(PAID_RULESET_HASH).toBe('0x1f3e8d6c57b309a94e9550a022396329611552c9d1f982cf64d050afa95fe85b')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', radiusMicro: 8_000_000_000, strengthBps: 6_000, overlapBps: 6_000 })
})
