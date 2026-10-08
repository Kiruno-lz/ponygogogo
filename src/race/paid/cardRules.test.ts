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
  expect(PAID_CARD_RULES_HASH).toBe('0x2fb8024634b4478068c7ee65317fbdcbe37194623bc3fc60758e1211de251923')
  expect(PAID_RULESET_HASH).toBe('0x62efd16f42433fff515a57b75b760d3cdded3db076947753ca9c2c9c83dbbe66')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
})
