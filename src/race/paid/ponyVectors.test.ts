import { expect, test } from 'bun:test'
import vectors from '../../../tests/vectors/pony-race-v5.json'
import { PAID_RULESET_HASH } from './cardRules.ts'
import { solvePaidCore } from './solver.ts'
import { decodeInput, encodeRace, type PaidVectorCase } from './vectorCodec.ts'

test('all roster vectors replay the reference solver and contain every enabled player ability', () => {
  expect(vectors.meta.rulesetHash).toBe(PAID_RULESET_HASH)
  const roles = new Set<number>()
  for (const item of vectors.cases as PaidVectorCase[]) {
    if (!('finishTime' in item.expected)) throw new Error('EXPECTED_FULL_RACE_VECTOR')
    const input = decodeInput(item.input)
    roles.add(input.roster![input.playerHorseId]!)
    expect(encodeRace(solvePaidCore(input, { trace: false }))).toEqual(item.expected)
  }
  expect([...roles].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
})
