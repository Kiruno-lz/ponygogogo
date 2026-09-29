import { describe, expect, test } from 'bun:test'
import { keccak256, toHex } from 'viem'
import type { PaidSessionFacts, PaidSettlementFacts } from '../chain/paidSession.ts'
import { solvePaidCore } from './paid/solver.ts'
import { fixtureInput, pickAt } from './paid/testkit.ts'
import { compareSettlement, paidChoiceNoteKeys, paidRaceResult, settledChoices, solveFromFacts } from './paidResult.ts'
import { solvePaidRace } from './paid/race.ts'

describe('paid result mapping', () => {
  // C-03 at checkpoint 1 cuts the next two checkpoints
  const cut = solvePaidCore(pickAt(fixtureInput({ playerDeck: [3, 22, 23, 24, 25, 26, 20, 19, 1, 2, 6, 7, 8, 10] }), 1, 3))

  test('preview RaceResult: settlement rank, sim finish tick, one entry per checkpoint', () => {
    const r = paidRaceResult('0xabc', '0xseed', 1, cut)
    expect(r).toMatchObject({ raceId: '0xabc', seed: '0xseed', horseId: 1, rank: cut.settlementRank, gogoClicks: [] })
    expect(r.finishTick).toBe(Number(cut.finishTime[1]! / 20n))
    expect(r.choices.map((c) => [c.checkpoint, c.cardId, c.reason])).toEqual([[0, 'C-03', 'picked'], [1, null, 'not-reached'], [2, null, 'not-reached']])
    expect(paidChoiceNoteKeys(cut)).toEqual([null, 'result.cut', 'result.cut'])
  })

  test('timeouts and active forfeits keep their own reasons', () => {
    const quiet = fixtureInput()
    const forfeit = solvePaidCore(pickAt(quiet, 1, 0))
    expect(paidRaceResult('s', 'x', 1, forfeit).choices.map((c) => c.reason)).toEqual(['forfeited', 'timeout', 'timeout'])
    expect(paidChoiceNoteKeys(forfeit)).toEqual([null, null, null])
  })

  test('chain vs browser: rank-only agreement is not a full match', () => {
    const chain: PaidSettlementFacts = {
      sessionId: '0x01', player: '0x0000000000000000000000000000000000000001', finishTime: cut.finishTime.map(Number),
      rawOrder: [...cut.rawOrder], settlementOrder: [...cut.settlementOrder], rank: cut.settlementRank, payout: 0n,
      digest: cut.digest, acquired: [3, 0, 0], hash: null, blockNumber: null,
    }
    expect(cut.acquiredByCheckpoint).toEqual([3, 0, 0])
    expect(compareSettlement(chain, cut)).toEqual({ rank: true, full: true })
    expect(compareSettlement({ ...chain, finishTime: [40_000, 41_000, 42_000, 43_000, 44_000] }, cut)).toEqual({ rank: true, full: false })
    expect(compareSettlement({ ...chain, acquired: [0, 0, 0] }, cut)).toEqual({ rank: true, full: false })
    expect(compareSettlement({ ...chain, rank: (cut.settlementRank % 5) + 1 }, cut).rank).toBe(false)
  })

  test('after settlement the choices show the cards SessionSettled.acquired reports', () => {
    const preview = paidRaceResult('s', 'x', 1, cut).choices
    expect(settledChoices(preview, [3, 0, 0])).toEqual(preview)
    // the chain says checkpoint 1 took nothing (the stored choice was ignored) and checkpoint 3 took C-21
    expect(settledChoices(preview, [0, 0, 21]).map((c) => [c.cardId, c.reason])).toEqual([
      [null, 'timeout'], [null, 'not-reached'], ['C-21', 'picked'],
    ])
  })

  test('solveFromFacts feeds on-chain choices (txSec, card, refreshes, anchor) to the solver', () => {
    const seed = keccak256(toHex('facts-seed'))
    const openAnchor = keccak256(toHex('facts-anchor'))
    const base: PaidSessionFacts = {
      sessionId: '0x02', player: '0x0000000000000000000000000000000000000002', state: 1, horseId: 0, stakeTier: 3, stake: 0n,
      seed, openedAt: 0, openedBlock: 1n, openAnchor, choices: [null, null, null],
    }
    const plain = solveFromFacts(base)
    const rec = plain.checkpoints[0]!
    const anchor = keccak256(toHex('choice-anchor'))
    const withChoice = { ...base, choices: [{ checkpoint: 1 as const, cardId: rec.candidates[0]!, refreshSlots: [], txSec: Number(rec.openSec), blockNumber: 5n, anchor }, null, null] as PaidSessionFacts['choices'] }
    const direct = solvePaidRace({
      seed, openAnchor, stakeTier: 3, playerHorseId: 0,
      choices: [{ txSec: rec.openSec, cardId: rec.candidates[0]!, refreshSlots: [], anchor }, null, null],
    }, { trace: false })
    expect(solveFromFacts(withChoice).digest).toBe(direct.digest)
    expect(solveFromFacts(withChoice, {}).trace).not.toBeNull()
  })
})
