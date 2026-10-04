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
  expect(PAID_CARD_RULES_HASH).toBe('0x632d100afd03a788e58c37b00bfc4fa84c841c2b96a7cad734b92bf0eb669bd0')
  expect(PAID_RULESET_HASH).toBe('0x4165ca878a179fe4f6a872ee937d6dd3bab34d734e723ab387ef2948e84e6eb7')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
})
