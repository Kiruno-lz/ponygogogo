import { describe, expect, test } from 'bun:test'
import { activeEquipmentVisuals, activeWindDirection, isSpinVisualActive } from '../game/effects.ts'
import { STAMINA_MAX, TRACK_LEN } from './core/constants.ts'
import { FP } from './core/fixed.ts'
import { EV_BOMB_PLACE, EV_CHECKPOINT, EV_FINISH, EV_SWAP, EV_WIND, type PaidLoggedEvent } from './paid/events.ts'
import { solvePaidCore } from './paid/solver.ts'
import { fixtureInput, pickAt } from './paid/testkit.ts'
import { sampleHorse, type PaidTrace } from './paid/trace.ts'
import {
  buildPaidSnapshot, demoPos, demoSpeed, demoStamina, effectsAt, eventsUpTo, finishRanks, idlePaidState,
  paidCardKey, paidCardNumber, tickOf, toRaceEvent,
} from './paidSnapshot.ts'

// Same busy fixture as src/race/paid/trace.test.ts: swaps, wheel, bombs, wind, rocket, rainbow, gravity.
const busy = pickAt(pickAt(fixtureInput({
  playerDeck: [9, 17, 18, 11, 21, 14, 15, 20, 19, 1, 2, 6, 7, 8],
  cpu: { 0: [7, 6, 12], 2: [1, 13, 19], 3: [10, 19, 20], 4: [8, 16, 15] },
}), 1, 9), 2, 11)
const full = solvePaidCore(busy)
const trace = full.trace as PaidTrace

describe('unit mapping', () => {
  test('µu, mu/s and µstamina map onto the demo fixed-point units', () => {
    expect(demoPos(100_000_000_000n)).toBe(TRACK_LEN)
    expect(demoPos(12_345_678n)).toBe(123_456)
    // 1300 units/s = 26 units per 20 ms tick
    expect(demoSpeed(1_300_000n) / FP).toBe(26)
    expect(demoStamina(1_000_000_000n)).toBe(STAMINA_MAX)
    expect(tickOf(1_000n)).toBe(50)
  })

  test('card keys round-trip and reject anything outside C-01..C-40', () => {
    expect(paidCardKey(7)).toBe('C-07')
    expect(paidCardNumber('C-26')).toBe(26)
    for (const bad of ['C-00', 'C-41', 'C-7', 'X-01', null]) expect(paidCardNumber(bad)).toBeNull()
  })

  test('finish ranks order by (finishTime, horseId) among horses already over the line', () => {
    expect(finishRanks([500n, 400n, 400n, 900n, 600001n], 600n)).toEqual([3, 1, 2, 0, 0])
    expect(finishRanks([500n, 400n, 400n, 900n, 600001n], 399n)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('snapshot', () => {
  const tau = trace.instances.find((i) => i.cardId === 7)!.startTau + 10n

  test('acquired C-02 spins only its owner for the solver’s 30-second window', () => {
    const input = pickAt(fixtureInput({ playerDeck: [2, ...busy.playerDeck.filter((id) => id !== 2)] }), 1, 2)
    const result = solvePaidCore(input)
    const spinTrace = result.trace!
    const instance = spinTrace.instances.find((i) => i.cardId === 2 && i.horse === input.playerHorseId)!
    expect(instance).toBeDefined()
    expect(instance.endTau).toBe(instance.startTau + 30_000n)
    const snapshotAt = (tau: bigint) => buildPaidSnapshot({
      trace: spinTrace, tau, playerHorseId: input.playerHorseId, stakeTier: 0, seed: input.seed,
      panel: null, draw: null, playerDeck: input.playerDeck, finishTime: result.finishTime, raceOver: false,
    })
    expect(isSpinVisualActive(snapshotAt(instance.startTau - 1n).effects, input.playerHorseId)).toBe(false)
    for (const offset of [0n, 15_000n, 29_999n]) {
      const { effects } = snapshotAt(instance.startTau + offset)
      const cardEffects = effects.filter((e) => e.sourceCardId === 'C-02' && e.ownerHorseId === input.playerHorseId)
      expect(cardEffects).toHaveLength(1)
      expect(cardEffects[0]).toMatchObject({
        instanceId: instance.id, primitive: 'Status', tags: ['buff', 'debuff'], durationTicks: 1500,
        payload: { statusId: 'luckE', spin: true },
      })
      expect(isSpinVisualActive(effects, input.playerHorseId)).toBe(true)
      expect(isSpinVisualActive(effects, 0)).toBe(false)
    }
    for (const offset of [30_000n, 30_001n]) {
      expect(isSpinVisualActive(snapshotAt(instance.startTau + offset).effects, input.playerHorseId)).toBe(false)
    }
    const events = spinTrace.events.map((e) => toRaceEvent(e, spinTrace, input.playerHorseId, result.finishTime))
    expect(events.filter((e) => e?.type === 'cardPicked' && e.cardId === 'C-02')).toHaveLength(1)
    expect(events.some((e) => e?.type === 'statusAdd' || e?.type === 'statusStack')).toBe(false)
  })

  test('other acquired cards never activate the spin visual', () => {
    for (let cardId = 1; cardId <= 40; cardId++) {
      if (cardId === 2) continue
      const playerDeck = [cardId, ...Array.from({ length: 40 }, (_, i) => i + 1)
        .filter((id) => id !== cardId && id !== 2)].slice(0, 14)
      const input = pickAt(fixtureInput({ playerDeck }), 1, cardId)
      const result = solvePaidCore(input)
      const otherTrace = result.trace!
      const card = otherTrace.cards.find((c) => c.cardId === cardId && c.horse === input.playerHorseId)!
      expect(card).toBeDefined()
      for (const offset of [0n, 1_000n, 30_000n]) {
        const { effects } = effectsAt(otherTrace, card.tau + offset, [false, false, false, false, false])
        expect(isSpinVisualActive(effects, input.playerHorseId)).toBe(false)
      }
    }
  })

  test('horses carry the exact solver sample at τ, converted', () => {
    const st = buildPaidSnapshot({
      trace, tau, playerHorseId: 1, stakeTier: 2, seed: '0x', panel: null, draw: null, playerDeck: busy.playerDeck,
      finishTime: full.finishTime, raceOver: false,
    })
    for (let h = 0; h < 5; h++) {
      const s = sampleHorse(trace, h, tau)
      expect(st.horses[h]).toMatchObject({
        horseId: h, laneIndex: s.lane, pos: demoPos(s.pos), dist: demoPos(s.dist), v: demoSpeed(s.v),
        stamina: demoStamina(s.stamina), finished: s.finished, isPlayer: h === 1,
      })
    }
    expect(st.tick).toBe(tickOf(tau))
    expect(st.playerHorseId).toBe(1)
    expect(st.pending).toBeNull()
    expect(st.abilityBinding).toBeNull()
  })

  test('equipment, wind and bombs reach the renderer helpers in their expected shape', () => {
    const late = trace.winds[0]!.tau + 1n
    const { effects, env } = effectsAt(trace, late, [false, false, false, false, false])
    expect(env?.payload.envKind).toBe('wind')
    expect(activeWindDirection(effects)).toBe(trace.winds[0]!.bps < 0n ? -1 : 1)
    const rocketTau = trace.instances.find((i) => i.cardId === 7)!.startTau
    expect(activeEquipmentVisuals(effectsAt(trace, rocketTau, [false, false, false, false, false]).effects, 0)).toEqual(['rocket'])
    const bomb = trace.bombs[0]!
    const st = buildPaidSnapshot({
      trace, tau: bomb.placedTau, playerHorseId: 1, stakeTier: 2, seed: '0x', panel: null, draw: null,
      playerDeck: busy.playerDeck, finishTime: full.finishTime, raceOver: false,
    })
    expect(st.hazards.length).toBe(4)
    expect(st.hazards[0]).toEqual({ hazardId: bomb.id, laneIndex: bomb.lane, pos: demoPos(bomb.pos), sourceCardId: 'C-06' })
  })

  test('exhaustion shows as the system.exhaust status the HUD looks for', () => {
    const { effects } = effectsAt(trace, 0n, [true, false, false, false, false])
    expect(effects.find((e) => e.ownerHorseId === 0 && e.payload.statusId === 'exhausted')?.sourceCardId).toBe('system.exhaust')
  })

  test('an open panel becomes the pending choice with C-xx keys, refresh credits and auto mode', () => {
    const st = buildPaidSnapshot({
      trace, tau: 1000n, playerHorseId: 1, stakeTier: 2, seed: '0x',
      panel: { checkpoint: 2, mode: 'auto', candidates: [4, 17, 22], refreshSlots: [], refreshCredits: 0, openTau: 900n },
      draw: null, playerDeck: busy.playerDeck, finishTime: full.finishTime, raceOver: false,
    })
    expect(st.pending).toMatchObject({ checkpoint: 1, candidates: ['C-04', 'C-17', 'C-22'], openedAtTick: 45 })
    expect(st.drawMode).toBe('auto')
  })

  test('idle state before T0 puts every horse on the start line in its own lane', () => {
    const st = idlePaidState(3, 4)
    expect(st.horses.map((h) => [h.laneIndex, h.pos, h.isPlayer])).toEqual([
      [0, 0, false], [1, 0, false], [2, 0, false], [3, 0, true], [4, 0, false],
    ])
    expect(st.stakeTier).toBe(4)
  })
})

describe('events', () => {
  test('solver events translate to renderer events', () => {
    const byCode = (code: number) => trace.events.find((e) => e.code === code)!
    expect(toRaceEvent(byCode(EV_CHECKPOINT), trace, 1, full.finishTime)).toMatchObject({ type: 'checkpoint', mark: 1 })
    expect(toRaceEvent(byCode(EV_SWAP), trace, 1, full.finishTime)).toMatchObject({ type: 'swap', a: 1 })
    expect(toRaceEvent(byCode(EV_WIND), trace, 1, full.finishTime)?.type).toBe('wind')
    const place = byCode(EV_BOMB_PLACE)
    expect(toRaceEvent(place, trace, 1, full.finishTime)).toMatchObject({ type: 'hazardPlaced', pos: demoPos(place.arg / 8n) })
    const firstFinish = trace.events.find((e) => e.code === EV_FINISH)!
    expect(toRaceEvent(firstFinish, trace, 1, full.finishTime)).toMatchObject({ type: 'finish', rank: 1 })
  })

  test('each event is emitted once, re-solved copies with a moved τ are not replayed, the floor mutes the past', () => {
    const emitted = new Set<string>()
    const mid = full.events[Math.floor(full.events.length / 2)]!.wall
    const first = eventsUpTo(full.events, mid, emitted, 0n)
    expect(first.length).toBeGreaterThan(0)
    expect(first.every((e) => e.wall <= mid)).toBe(true)
    expect(eventsUpTo(full.events, mid, emitted, 0n)).toEqual([])
    // a re-solve moved every event by 3 ms: nothing new up to mid
    const shifted: PaidLoggedEvent[] = full.events.map((e) => ({ ...e, tau: e.tau + 3n, wall: e.wall + 3n }))
    expect(eventsUpTo(shifted, mid, emitted, 0n)).toEqual([])
    const rest = eventsUpTo(full.events, full.events.at(-1)!.wall, emitted, 0n)
    expect(first.length + rest.length).toBe(full.events.length)
    const resumed = new Set<string>()
    const silent = eventsUpTo(full.events, mid, resumed, mid)
    expect(silent.every((e) => e.wall >= mid)).toBe(true)
  })
})
