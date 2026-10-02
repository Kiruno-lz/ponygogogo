import { expect, test } from 'bun:test'
import { MAX_BOMBS, MAX_EVENTS, MAX_INSTANCES, MAX_TAU, NEVER, UNFINISHED_TAU } from './constants.ts'
import { EV_CARD, EV_SWAP, EV_SWAP_BLOCKED } from './events.ts'
import { solvePaidCore, type PaidCoreInput } from './solver.ts'
import { fixtureInput, fixtureProfiles, pickAt } from './testkit.ts'

test('a horse that never reaches the line gets 600001 and the race stops at τ = 600000', () => {
  const profiles = fixtureProfiles()
  profiles[2] = { base: 0n, acceleration: 0n, cap: 0n }
  const r = solvePaidCore(fixtureInput({ profiles }), { trace: false })
  expect(r.finishTime[2]).toBe(UNFINISHED_TAU)
  // IPaidRaceSolver: an unfinished horse's finishWall is wall(600000), finite so settlement can be gated on it.
  expect(r.finishWall[2]).toBe(r.wallEnd)
  expect(r.wallEnd).toBe(r.checkpoints[2]!.closeWall + (MAX_TAU - r.checkpoints[2]!.closeTau))
  expect(solvePaidCore(fixtureInput({ profiles }), { untilWall: 30_000n, trace: false }).finishWall[2]).toBe(NEVER)
  expect(r.tauEnd).toBe(MAX_TAU)
  expect(r.rawOrder.at(-1)).toBe(2)
  expect(r.status).toBe('complete')
})

const VERSION_DECK = [17, 22, 23, 19, 24, 25, 21, 26, 20, 1, 2, 6, 7, 8]

test('version answer: 薄肌 + 黄毛 + 理解孙学 puts the player first in settlement only', () => {
  const input = pickAt(pickAt(pickAt(fixtureInput({ playerDeck: VERSION_DECK }), 1, 17), 2, 19), 3, 21)
  const r = solvePaidCore(input)
  expect(r.acquired).toEqual([17, 19, 21])
  expect(r.acquiredByCheckpoint).toEqual([17, 19, 21])
  expect(r.versionAnswer).toBe(true)
  expect(r.rawRank).toBeGreaterThan(1)
  expect(r.settlementRank).toBe(1)
  expect(r.settlementOrder).toEqual([1, ...r.rawOrder.filter((h) => h !== 1)])
  const sorted = [0, 1, 2, 3, 4].sort((a, b) => Number(r.finishTime[a]! - r.finishTime[b]!) || a - b)
  expect(r.rawOrder).toEqual(sorted)
})

test('version answer needs every piece; a missing piece keeps settlement = raw', () => {
  const input = pickAt(pickAt(fixtureInput({ playerDeck: VERSION_DECK }), 1, 17), 2, 19)
  const r = solvePaidCore(input)
  expect(r.acquiredByCheckpoint).toEqual([17, 19, 0])
  expect(r.versionAnswer).toBe(false)
  expect(r.settlementOrder).toEqual(r.rawOrder)
  // CPU horses holding the pieces never trigger it.
  const cpu = solvePaidCore(fixtureInput({ cpu: { 0: [17, 19, 21] } }))
  expect(cpu.versionAnswer).toBe(false)
})

test('gogo has no input path: the input shape has no such field and extra fields change nothing', () => {
  const input = fixtureInput()
  expect(Object.keys(input).sort()).toEqual(['choices', 'cpuDecks', 'openAnchor', 'playerDeck', 'playerHorseId', 'profiles', 'seed'])
  const tapped = { ...input, gogo: [1, 2, 3, 5, 8], taps: 999, camera: -40 } as unknown as PaidCoreInput
  expect(solvePaidCore(tapped).digest).toBe(solvePaidCore(input).digest)
})

test('a card acquired at an event ms can trigger in the same ms (C-09 attempt 0 right after the card)', () => {
  const r = solvePaidCore(fixtureInput({ cpu: { 0: [9, 20, 5] } }))
  const card = r.events.findIndex((e) => e.code === EV_CARD && e.arg === 9n)
  expect([EV_SWAP, EV_SWAP_BLOCKED]).toContain(r.events[card + 1]!.code)
  expect(r.events[card + 1]!.tau).toBe(r.events[card]!.tau)
})

test('caps stay unreachable: five bomb/death/swap-heavy decks remain far below 64 instances and 4096 events', () => {
  const heavy = [6, 2, 9]
  const input = pickAt(pickAt(fixtureInput({
    playerDeck: [6, 22, 23, 2, 24, 25, 9, 26, 20, 19, 1, 7, 8, 10],
    cpu: { 0: heavy, 2: [6, 9, 2], 3: [2, 6, 9], 4: [9, 2, 6] },
  }), 1, 6), 2, 2)
  const r = solvePaidCore(input)
  expect(r.trace!.cards.filter((c) => c.cardId === 2).length).toBe(5)
  expect(r.trace!.bombs.length).toBe(MAX_BOMBS)
  // ≤ 5 horses × (3 cards + 2 C-04 bonuses) + 25 respawns (≤ 20 bombs + 5 C-02) + 5 steal re-equips = 55.
  expect(r.trace!.instances.length).toBeLessThan(MAX_INSTANCES)
  expect(r.eventCount).toBeLessThan(MAX_EVENTS / 8)
  expect(r.status).toBe('complete')
})
