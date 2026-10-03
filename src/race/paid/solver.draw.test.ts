import { expect, test } from 'bun:test'
import { EV_PANEL_CUT, INVALID_BAD_SLOT, INVALID_CUT, INVALID_NO_CREDIT, INVALID_NOT_OFFERED } from './events.ts'
import { solvePaidCore } from './solver.ts'
import { fixtureInput, ignoredChoice, pickAt } from './testkit.ts'
import { wallAtTau } from './trace.ts'

test('C-03 cuts later checkpoints: no panel, no slow motion, cursor stays put', () => {
  const deck = [3, 17, 18, 21, 14, 15, 20, 19, 1, 2, 6, 7, 8, 10]
  const input = pickAt(fixtureInput({ playerDeck: deck }), 1, 3)
  const r = solvePaidCore(input)
  const [, two, three] = r.checkpoints
  for (const rec of [two!, three!]) {
    expect(rec).toMatchObject({ reached: true, mode: 'cut', reason: 'cut', cardId: 0, openSec: 0n, candidates: [] })
    expect(rec.closeTau).toBe(rec.openTau)
    expect(rec.closeWall).toBe(rec.openWall)
  }
  expect(r.events.filter((e) => e.code === EV_PANEL_CUT).map((e) => e.arg)).toEqual([2n, 3n])
  // Only the first panel slowed the race: afterwards wall − τ is constant.
  const offset = r.checkpoints[0]!.closeWall - r.checkpoints[0]!.closeTau
  expect(r.finishWall[1]! - r.finishTime[1]!).toBe(offset)
  expect(wallAtTau(r.trace!, three!.openTau)).toBe(three!.openTau + offset)
  const stop = solvePaidCore(input, { stopAtPanel: 3 })
  expect(stop.panel).toMatchObject({ mode: 'cut', candidates: [], drawState: { cursor: 3, forfeited: true } })
  expect(ignoredChoice({ ...input, choices: [input.choices[0], { ...input.choices[0]!, txSec: 60n }, null] }, 2))
    .toEqual({ reason: INVALID_CUT, equivalent: true })
})

test('C-03 taken at the last checkpoint has no cost (nothing left to cut)', () => {
  const deck = [17, 18, 21, 14, 15, 20, 3, 19, 1, 2, 6, 7, 8, 10]
  const r = solvePaidCore(pickAt(fixtureInput({ playerDeck: deck }), 3, 3))
  expect(r.checkpoints.map((c) => c.reason)).toEqual(['timeout', 'timeout', 'picked'])
  expect(r.acquired).toEqual([3])
})

test('C-04 bonus follows the card: finite duration, permanent, 20 s default, steal loot duration', () => {
  const bonusEnds = (cpu: Record<number, number[]>) => {
    const r = solvePaidCore(fixtureInput({ cpu }))
    return r.trace!.instances.filter((i) => i.horse === 0 && i.kind === 'bonus')
      .map((i) => [i.cardId, i.plannedEndTau === null ? null : i.plannedEndTau - i.startTau])
  }
  expect(bonusEnds({ 0: [4, 1, 12] })).toEqual([[1, 30_000n], [12, null]])
  expect(bonusEnds({ 0: [4, 6, 15] })).toEqual([[6, 20_000n], [15, 20_000n]])
  expect(bonusEnds({ 0: [4, 13, 22] })).toEqual([[13, 20_000n], [22, 12_000n]])
  expect(bonusEnds({ 0: [4, 7, 13], 2: [8, 19, 20] })).toEqual([[7, 40_000n], [13, 60_000n]])
  expect(bonusEnds({ 0: [4, 17, 21] })).toEqual([[17, null], [21, null]])
  expect(bonusEnds({ 0: [4, 9, 16] })).toEqual([[9, 30_000n], [16, 10_000n]])
  expect(bonusEnds({ 0: [4, 8, 10] })).toEqual([[8, 60_000n], [10, 10_000n]])
  expect(bonusEnds({ 0: [4, 2, 3] })).toEqual([[2, 30_000n], [3, 20_000n]])
  expect(bonusEnds({ 0: [4, 11, 14] })).toEqual([[11, 30_000n], [14, 5_000n]])
})

test('C-05 refresh replaces one offered card from the tail and consumes the credit', () => {
  const deck = [5, 17, 21, 14, 15, 16, 20, 19, 1, 2, 6, 7, 8, 18]
  const input = pickAt(fixtureInput({ playerDeck: deck }), 1, 5)
  const stop = solvePaidCore(input, { stopAtPanel: 2 })
  expect(stop.panel).toMatchObject({ candidates: [14, 15, 16], drawState: { refreshCredits: 1, tailCursor: 14 } })
  const refreshed = pickAt(input, 2, 18, { refreshSlots: [1] })
  const r = solvePaidCore(refreshed)
  expect(r.checkpoints[1]).toMatchObject({ reason: 'picked', cardId: 18, candidates: [14, 18, 16] })
  expect(r.acquired).toEqual([5, 18])
  expect(solvePaidCore(refreshed, { stopAtPanel: 3 }).panel).toMatchObject({
    candidates: [20, 19, 1], drawState: { cursor: 6, tailCursor: 13, refreshCredits: 0 },
  })
  expect(ignoredChoice(pickAt(input, 2, 18, { refreshSlots: [0, 1] }), 2)).toEqual({ reason: INVALID_NO_CREDIT, equivalent: true })
  expect(ignoredChoice(pickAt(input, 2, 18, { refreshSlots: [1, 1] }), 2)).toEqual({ reason: INVALID_NO_CREDIT, equivalent: true })
  expect(ignoredChoice(pickAt(input, 2, 15, { refreshSlots: [1] }), 2)).toEqual({ reason: INVALID_NOT_OFFERED, equivalent: true })
  expect(ignoredChoice(pickAt(input, 2, 15, { refreshSlots: [3] }), 2)).toEqual({ reason: INVALID_BAD_SLOT, equivalent: true })
  // Without a credit any refresh is rejected first, however malformed.
  expect(ignoredChoice(pickAt(fixtureInput(), 1, 0, { refreshSlots: [7] }), 1)).toEqual({ reason: INVALID_NO_CREDIT, equivalent: true })
  // A refresh may accompany an active forfeit; the tail card is still spent.
  const forfeit = solvePaidCore(pickAt(input, 2, 0, { refreshSlots: [2] }), { stopAtPanel: 3 })
  expect(forfeit.panel!.drawState).toMatchObject({ tailCursor: 13, refreshCredits: 0 })
})

test('C-04 removes refresh rights even with unused credits', () => {
  const deck = [5, 17, 21, 4, 14, 15, 20, 19, 1, 2, 6, 7, 8, 18]
  const input = pickAt(pickAt(fixtureInput({ playerDeck: deck }), 1, 5), 2, 4)
  const r = solvePaidCore(input)
  expect(r.checkpoints[2]!.mode).toBe('auto')
  expect(r.acquired.slice(0, 2)).toEqual([5, 4])
  expect(solvePaidCore(input, { stopAtPanel: 3 }).panel!.drawState).toMatchObject({ automatic: true, refreshCredits: 1 })
})
