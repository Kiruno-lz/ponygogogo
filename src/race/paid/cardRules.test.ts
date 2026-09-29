import { expect, test } from 'bun:test'
import { CARD_POOL } from '../cards/pool.ts'
import { PAID_CARD_RULES, PAID_CARD_RULES_HASH, PAID_CPU_MASK, PAID_RARE_MASK, PAID_RULESET_HASH, paidCardRule } from './cardRules.ts'

test('one paid card table covers 26 cards and matches the existing rarity/CPU eligibility', () => {
  expect(PAID_CARD_RULES).toHaveLength(26)
  for (const card of CARD_POOL) {
    const id = Number(card.cardId.slice(2))
    expect(paidCardRule(id).rare).toBe(card.quality === 'rare')
    expect(paidCardRule(id).cpu).toBe(card.cpuUsable)
  }
  expect(PAID_RARE_MASK).toBe(0x12973en)
  expect(PAID_CPU_MASK).toBe(0x3fae3n)
  expect(PAID_CARD_RULES_HASH).toBe('0xefde6ab7e0485adacf6a2c7da46532ddb26480e62ef01a7360e28814a0e3f1c4')
  expect(PAID_RULESET_HASH).toBe('0x5ff01a27886c1cad8a1d286cf2bb15280f711d7133ab3377b375855bf5d3f84b')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', radiusMicro: 8_000_000_000, strengthBps: 6_000, overlapBps: 6_000 })
})
