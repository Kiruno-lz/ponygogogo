import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { heavySolverInput, parseSessionConfig } from '../../../scripts/testnet-session.ts'
import { PAID_RULESET_HASH } from '../../../src/race/paid/cardRules.ts'
import { solvePaidRace } from '../../../src/race/paid/race.ts'

const env = { VITE_PONY_GAME_ADDRESS: `0x${'11'.repeat(20)}`, VITE_PONY_VAULT_ADDRESS: `0x${'22'.repeat(20)}`, VITE_ALCHEMY_API_KEY: 'local-fixture', VITE_ALCHEMY_POLICY_ID: 'local-fixture' }
test('session tooling carries a supplied roster and rejects duplicate roles before preparing entry', () => {
  expect(parseSessionConfig(env, ['--roster','8,5,7,6,0']).roster).toEqual([8,5,7,6,0])
  expect(parseSessionConfig(env, []).roster).toEqual([0,1,2,3,4])
  for (const roster of ['0,0,1,2,3','0,1,2,3,9','0,1,2','horse','']) {
    expect(() => parseSessionConfig(env, ['--roster',roster])).toThrow()
  }
})

test('heavy probes use a reachable v5 vector, including its exact tier and roster', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../vectors/pony-race-v5.json', import.meta.url), 'utf8'))
  const { vector, input } = heavySolverInput(vectors)
  expect([...input.roster]).toEqual(vector.input.roster!)
  expect(Number(input.stakeTier)).toBe(vector.stakeTier!)
  const choices = input.choices.map(c => c.present ? { txSec: BigInt(c.txSec), cardId: c.cardId, refreshSlots: c.refreshSlots, anchor: c.anchor } : null) as never
  const result = solvePaidRace({ ...input, choices }, { trace: false })
  expect(result.digest).toBe(vector.expected.digest)
  expect(result.stepCount).toBe(vector.expected.stepCount)
  expect(() => heavySolverInput({ ...vectors, meta: { rulesetHash: 'legacy' } })).toThrow('STALE_HEAVY_VECTOR_RULESET')
  expect(vectors.meta.rulesetHash).toBe(PAID_RULESET_HASH)
})
