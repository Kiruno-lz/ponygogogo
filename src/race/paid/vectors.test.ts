import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PAID_RULESET_HASH } from './constants.ts'
import { PAID_CHOICE_INVALID_NAMES } from './events.ts'
import { checkPaidChoice, classifyPaidChoice, type PaidChoiceSlots } from './solver.ts'
import { decodeInput, encodeInput, solveVectorCase, type PaidVectorCase, type PaidVectorRace } from './vectorCodec.ts'

/** tests/vectors/paid-race-v4.json is the Solidity port's oracle; it must stay equal to a fresh solve. */
const file = JSON.parse(readFileSync(new URL('../../../tests/vectors/paid-race-v4.json', import.meta.url), 'utf8')) as {
  meta: { rulesetHash: string; count: number }
  cases: PaidVectorCase[]
}

describe('paid ruleset v4 cross-language vectors', () => {
  test('file header', () => {
    expect(file.meta.rulesetHash).toBe(PAID_RULESET_HASH)
    expect(file.cases.length).toBe(file.meta.count)
    expect(file.cases.length).toBeGreaterThanOrEqual(250)
    expect(new Set(file.cases.map((c) => c.name)).size).toBe(file.cases.length)
  })

  test('every CHOICE_INVALID reason reachable from PonyGame storage has a case', () => {
    const seen = new Set<number>()
    for (const c of file.cases) {
      if (c.stopAtPanel !== undefined) continue
      for (const rec of (c.expected as PaidVectorRace).checkpoints) if (rec.invalidReason !== 0) seen.add(rec.invalidReason)
    }
    // INVALID_EXHAUSTED (9) needs two refresh credits, and a 14-card deck of distinct ids holds one C-05.
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10])
  })

  for (const c of file.cases) {
    test(c.name, () => {
      const input = decodeInput(c.input)
      expect(encodeInput(input)).toEqual(c.input)
      expect(solveVectorCase(c.name, input, c.stopAtPanel)).toEqual(c)
      if (c.stopAtPanel !== undefined) return
      // Every stored choice gets the same verdict from the browser helpers with only the earlier choices present.
      const records = (c.expected as PaidVectorRace).checkpoints
      for (const k of [1, 2, 3] as const) {
        if (input.choices[k - 1] === null) continue
        const prefix = input.choices.map((slot, i) => i < k ? slot : null) as unknown as PaidChoiceSlots
        const rec = records[k - 1]!
        const verdict = classifyPaidChoice({ ...input, choices: prefix }, k)
        expect(verdict.reason).toBe(rec.invalidReason === 0 ? null : PAID_CHOICE_INVALID_NAMES[rec.invalidReason]!)
        expect(verdict.openSec).toBe(BigInt(rec.openSec))
        if (rec.invalidReason === 0) expect(checkPaidChoice({ ...input, choices: prefix }, k)).toBe(BigInt(rec.openSec))
        else expect(() => checkPaidChoice({ ...input, choices: prefix }, k)).toThrow()
      }
    })
  }
})
