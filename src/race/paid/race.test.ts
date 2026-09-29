import { expect, test } from 'bun:test'
import { derivePaidCpuDeck } from '../core/paidCpuDeck.ts'
import { derivePaidDeck } from '../core/paidDeck.ts'
import { derivePaidProfiles } from '../core/paidProfiles.ts'
import { derivePaidCoreInput, solvePaidRace } from './race.ts'
import { solvePaidCore } from './solver.ts'
import { FIXTURE_ANCHOR, FIXTURE_SEED } from './testkit.ts'

const input = { seed: FIXTURE_SEED, openAnchor: FIXTURE_ANCHOR, stakeTier: 3 as const, playerHorseId: 2, choices: [null, null, null] as const }

test('solvePaidRace derives personalities and decks from the opening anchor only', () => {
  const core = derivePaidCoreInput(input)
  expect(core.profiles.map((p) => Number(p.base))).toEqual(derivePaidProfiles(FIXTURE_SEED, FIXTURE_ANCHOR, 3, 2).map((p) => p.base))
  expect(core.playerDeck).toEqual(derivePaidDeck(FIXTURE_SEED, FIXTURE_ANCHOR))
  expect(core.cpuDecks[0]).toEqual(derivePaidCpuDeck(FIXTURE_SEED, FIXTURE_ANCHOR, 0))
  expect(core.cpuDecks[2]).toEqual([0, 0, 0])
  const race = solvePaidRace(input, { trace: false })
  expect(race.digest).toBe(solvePaidCore(core, { trace: false }).digest)
  expect(race.status).toBe('complete')
  expect(solvePaidRace(input, { stopAtPanel: 1, trace: false }).panel!.candidates).toEqual(core.playerDeck.slice(0, 3))
})

test('the player card mask restricts the deck', () => {
  const mask = (1n << 21n) - 1n
  const core = derivePaidCoreInput({ ...input, cardMask: mask })
  expect(core.playerDeck.every((id) => id <= 21)).toBe(true)
  expect(core.playerDeck).toEqual(derivePaidDeck(FIXTURE_SEED, FIXTURE_ANCHOR, mask))
})
