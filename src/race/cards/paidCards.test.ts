import { expect, test } from 'bun:test'
import { PAID_CARD_RULES } from '../paid/cardRules.ts'
import { paidCardDef } from './paidCards.ts'

test('every paid card has a card face whose text is generated from paidCardRule', () => {
  for (const rule of PAID_CARD_RULES) {
    const key = `C-${String(rule.id).padStart(2, '0')}`
    const def = paidCardDef(key)!
    expect(def.cardId).toBe(key)
    expect(def.quality).toBe(rule.rare ? 'rare' : 'common')
    for (const lang of ['zh', 'en'] as const) {
      expect(def.desc[lang].length).toBeGreaterThan(3)
      expect(def.name[lang].length).toBeGreaterThan(0)
    }
    if (rule.pBps) expect(def.desc.en).toContain(`${rule.pBps / 100}%`)
    if (rule.durationMs) expect(def.desc.en).toContain(`${rule.durationMs / 1000}s`)
    if (rule.fixedSpeed) expect(def.desc.en).toContain(`+${rule.fixedSpeed}`)
  }
  // paid rules, not the demo pool: C-09 swaps automatically every 2 s, no gogo involved
  expect(paidCardDef('C-09')!.desc.en).toContain('every 2s')
  expect(paidCardDef('C-09')!.desc.zh).not.toContain('gogo')
  expect(paidCardDef('C-11')!.desc.zh).not.toContain('长按')
  expect(paidCardDef('C-00')).toBeUndefined()
  expect(paidCardDef('C-27')).toBeUndefined()
  expect(paidCardDef('C-01')).toBe(paidCardDef('C-01'))
})
