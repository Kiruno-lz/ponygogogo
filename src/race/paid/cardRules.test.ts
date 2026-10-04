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
  expect(PAID_CARD_RULES_HASH).toBe('0x5fe93ed7989dd76dcccbc106fc2c4d0441b0c046f09e722906afd77a3b143912')
  expect(PAID_RULESET_HASH).toBe('0xbb2c9df7e6a29f0c6c54510063905c4652e08e0e987b262484cc77eb46dae876')
  expect(paidCardRule(10)).toMatchObject({ effect: 'gravity', radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 })
})
