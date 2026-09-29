import { expect, test } from 'bun:test'
import { applyPaidChoice, classifyPaidDraw, initialPaidDrawState, resolvePaidAutomaticChoice } from './paidDrawRules.ts'
import {
  INVALID_AUTO, INVALID_BAD_SLOT, INVALID_CUT, INVALID_EXHAUSTED, INVALID_NO_CREDIT, INVALID_NOT_OFFERED,
} from '../paid/events.ts'

const deck = [5, 4, 3, 17, 19, 21, 6, 7, 8, 9, 10, 11, 12, 18] as const

test('treasure earns one refresh and the next choice consumes only that credit', () => {
  const first = applyPaidChoice(deck, initialPaidDrawState(), [], 5)
  expect(first).toEqual({ cursor: 3, tailCursor: 14, refreshCredits: 1, automatic: false, forfeited: false })
  expect(applyPaidChoice(deck, first, [1], 18)).toEqual({ cursor: 6, tailCursor: 13, refreshCredits: 0, automatic: false, forfeited: false })
  expect(() => applyPaidChoice(deck, first, [1, 2], 17)).toThrow('NO_REFRESH_CREDIT')
})

test('last ripple forfeits future checkpoints without consuming cards', () => {
  const afterRipple = applyPaidChoice(deck, initialPaidDrawState(), [], 3)
  expect(afterRipple).toEqual({ cursor: 3, tailCursor: 14, refreshCredits: 0, automatic: false, forfeited: true })
  expect(() => applyPaidChoice(deck, afterRipple, [], 17)).toThrow('CHOICE_DISABLED')
})

test('decision paralysis disables later user input and chooses from the canonical offer', () => {
  const afterDecision = applyPaidChoice(deck, initialPaidDrawState(), [], 4)
  expect(afterDecision.automatic).toBe(true)
  expect(() => applyPaidChoice(deck, afterDecision, [], 17)).toThrow('CHOICE_DISABLED')
  const auto = resolvePaidAutomaticChoice(deck, afterDecision, `0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`, 2)
  expect(auto.cardId).toBe(21)
  expect(auto.state.cursor).toBe(6)
})

test('classifyPaidDraw names the first rule applyPaidChoice would break, without throwing', () => {
  const start = initialPaidDrawState()
  const credit = applyPaidChoice(deck, start, [], 5)
  expect(classifyPaidDraw(deck, start, [], deck[1]!)).toBe(0)
  expect(classifyPaidDraw(deck, start, [], 0)).toBe(0)
  expect(classifyPaidDraw(deck, credit, [1], deck[13]!)).toBe(0)
  expect(classifyPaidDraw(deck, { ...start, forfeited: true, automatic: true }, [], 0)).toBe(INVALID_CUT)
  expect(classifyPaidDraw(deck, { ...start, automatic: true }, [], 0)).toBe(INVALID_AUTO)
  expect(classifyPaidDraw(deck, start, [0], 0)).toBe(INVALID_NO_CREDIT)
  expect(classifyPaidDraw(deck, credit, [0, 0], 0)).toBe(INVALID_NO_CREDIT)
  expect(classifyPaidDraw(deck, { ...credit, refreshCredits: 2 }, [0, 0], 0)).toBe(INVALID_BAD_SLOT)
  expect(classifyPaidDraw(deck, credit, [3], 0)).toBe(INVALID_BAD_SLOT)
  expect(classifyPaidDraw(deck, { ...credit, tailCursor: 6 }, [0], 0)).toBe(INVALID_EXHAUSTED)
  expect(classifyPaidDraw(deck, { ...start, cursor: 12 }, [], 0)).toBe(INVALID_EXHAUSTED)
  expect(classifyPaidDraw(deck, credit, [1], deck[4]!)).toBe(INVALID_NOT_OFFERED)
  expect(classifyPaidDraw(deck, start, [], 27)).toBe(INVALID_NOT_OFFERED)
  // Agreement with applyPaidChoice over every state, refresh list and card this deck can present.
  for (const state of [start, credit, { ...credit, refreshCredits: 2 }, { ...start, cursor: 9, tailCursor: 13, refreshCredits: 1 }]) {
    for (const slots of [[], [0], [2], [0, 2], [1, 1], [4]]) {
      for (const card of [0, ...deck, 27]) {
        let threw = false
        try { applyPaidChoice(deck, state, slots, card) } catch { threw = true }
        expect(classifyPaidDraw(deck, state, slots, card) !== 0).toBe(threw)
      }
    }
  }
})
