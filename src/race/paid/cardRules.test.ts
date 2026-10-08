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
  expect(PAID_CARD_RULES_HASH).toBe('0x0aaa341ca75aedcc2a4c83b300312c7dfc1739278a37a146730d5e7b1cf937e0')
  expect(PAID_RULESET_HASH).toBe('0x6378623098ec1be1026bb5a663baf5890d3fe02da549708afa1de3facfa371b6')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', durationMs: 20_000, radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
  expect(paidCardRule(29)).toMatchObject({ effect: 'coatGate', bonusMode: 'permanent', pBps: 20_000, regenBonusBps: 15_000 })
})
