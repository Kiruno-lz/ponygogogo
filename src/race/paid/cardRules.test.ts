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
  expect(PAID_CARD_RULES_HASH).toBe('0x30dea918dfc50683a877ad59c4381a0ef3812ec44456f44a92a6960aaa9b4450')
  expect(PAID_RULESET_HASH).toBe('0xeb03664a530fd6d5251118e5074b9bd2fa6c5cce60385d94779199160f45edd6')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
})
