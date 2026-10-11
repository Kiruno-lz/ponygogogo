import { expect, test } from 'bun:test'
import { PAID_CARD_RULES } from '../paid/cardRules.ts'
import { paidCardDef, PAID_CARD_POOL } from './paidCards.ts'
import { t } from '../../ui/i18n.ts'
import { CARD_METADATA } from './metadata.ts'

test('the runtime pool itself contains complete canonical faces without duplicate effect declarations', () => {
  expect(PAID_CARD_POOL).toHaveLength(PAID_CARD_RULES.length)
  expect(CARD_METADATA).toHaveLength(PAID_CARD_RULES.length)
  expect(new Set(CARD_METADATA.map(card => card.cardId)).size).toBe(PAID_CARD_RULES.length)
  for (const rule of PAID_CARD_RULES) {
    const face = PAID_CARD_POOL[rule.id - 1]!
    expect(face).toBe(paidCardDef(face.cardId)!)
    expect(face.cpuUsable).toBe(rule.cpu)
    expect('effects' in face).toBe(false)
    expect('modules' in face).toBe(false)
  }
})

test('per-card bilingual copy interpolates only canonical rule parameters', () => {
  for (const rule of PAID_CARD_RULES) {
    const key = `C-${String(rule.id).padStart(2, '0')}`
    const def = paidCardDef(key)!
    expect(def.cardId).toBe(key)
    expect(def.quality).toBe(rule.rare ? 'rare' : 'common')
    for (const lang of ['zh', 'en'] as const) {
      expect(def.name[lang].length).toBeGreaterThan(0)
    }
    for (const part of ['meme', 'effect'] as const) {
      for (const lang of ['zh', 'en'] as const) {
        const template = t(lang, `card.${key}.${part}`)
        const rendered = part === 'effect' ? def.desc[lang] : def.meme[lang]
        expect(rendered).not.toMatch(/\{[a-zA-Z]\w*\}/)
        if (template.includes('{pPercent}')) expect(rendered).toContain(`${rule.pBps! / 100}%`)
        if (template.includes('{durationSeconds}')) expect(rendered).toContain(`${rule.durationMs! / 1000}`)
        if (template.includes('{fixedSpeed}')) expect(rendered).toContain(`${rule.fixedSpeed}`)
      }
    }
  }
  expect(paidCardDef('C-00')).toBeUndefined()
  expect(paidCardDef('C-41')).toBeUndefined()
  expect(paidCardDef('C-01')).toBe(paidCardDef('C-01'))
})

test('intentionally blank card effects stay empty in both runtime languages', () => {
  for (const id of ['C-13', 'C-19', 'C-20']) expect(paidCardDef(id)!.desc).toEqual({ zh: '', en: '' })
})
