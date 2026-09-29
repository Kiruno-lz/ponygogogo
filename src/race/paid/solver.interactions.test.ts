import { describe, expect, test } from 'bun:test'
import { chainEntropy } from '../core/chainEntropy.ts'
import { PURPOSE_STEAL, PURPOSE_WIND, TRACK_MICRO } from './constants.ts'
import {
  EV_BOMB_EXPLODE, EV_DEATH, EV_DEATH_IMMUNE, EV_EQUIP_OFF, EV_EQUIP_ON, EV_RESPAWN_END, EV_STEAL, EV_SWAP,
  EV_SWAP_BLOCKED, EV_WHEEL_BURST, EV_WIND, PAID_EVENT_NAMES,
} from './events.ts'
import { motionDelta } from './motion.ts'
import { solvePaidCore, type PaidSolveResult } from './solver.ts'
import { FIXTURE_SEED, fixtureAnchor, fixtureInput, fixtureProfiles, pickAt, QUIET_DECK } from './testkit.ts'
import { bombsAt, sampleHorse, sampleStatus, windAt } from './trace.ts'

function at(r: PaidSolveResult, tau: bigint): string[] {
  return r.events.filter((e) => e.tau === tau).map((e) => `${PAID_EVENT_NAMES[e.code]}:h${e.horse}`)
}

function deckWith(...front: number[]): number[] {
  return [...front, ...QUIET_DECK.filter((c) => !front.includes(c))].slice(0, 14)
}

describe('death, respawn and bombs', () => {
  const twoBombs = solvePaidCore(fixtureInput({ cpu: { 0: [6, 25, 26], 2: [6, 25, 26] } }))

  test('a second bomb within 5 s of a death is consumed without killing (respawn immunity)', () => {
    const h3 = twoBombs.events.filter((e) => e.horse === 3 && [EV_BOMB_EXPLODE, EV_DEATH, EV_DEATH_IMMUNE, EV_RESPAWN_END].includes(e.code))
    expect(h3.map((e) => PAID_EVENT_NAMES[e.code])).toEqual(['BOMB_EXPLODE', 'DEATH', 'BOMB_EXPLODE', 'DEATH_IMMUNE', 'RESPAWN_END'])
    const [hit, death, second, , end] = h3
    expect(death!.tau).toBe(hit!.tau)
    expect(second!.tau - death!.tau).toBeLessThan(5_000n)
    expect(end!.tau).toBe(death!.tau + 5_000n)
    const bombs = twoBombs.trace!.bombs
    expect(bombs[Number(hit!.arg)]).toMatchObject({ lane: 3, placer: 0, victim: 3, goneTau: hit!.tau })
    expect(bombs[Number(second!.arg)]).toMatchObject({ lane: 3, placer: 2, victim: 3, goneTau: second!.tau })
    // Death zeroes b and K only; the horse restarts from rest at its current position.
    expect(sampleHorse(twoBombs.trace!, 3, death!.tau)).toMatchObject({ b: 0n, v: 0n })
  })

  test('bombs trigger only on continuous crossing pos_before < bombPos ≤ pos_after in the bomb lane', () => {
    for (const e of twoBombs.events.filter((ev) => ev.code === EV_BOMB_EXPLODE)) {
      const bomb = twoBombs.trace!.bombs[Number(e.arg)]!
      const frame = twoBombs.trace!.keyframes[e.horse]!.find((f) => f.tau1 === e.tau && f.tau0 < e.tau)!
      expect(frame.lane).toBe(bomb.lane)
      expect(frame.pos).toBeLessThan(bomb.pos)
      expect(sampleHorse(twoBombs.trace!, e.horse, e.tau).pos).toBeGreaterThanOrEqual(bomb.pos)
    }
  })

  test('same-ms order: bomb (class 3) before checkpoint (class 5); death before the panel opens', () => {
    expect(at(twoBombs, 18_662n)).toEqual(['BOMB_EXPLODE:h3', 'DEATH:h3', 'CHECKPOINT:h3', 'CARD:h3'])
    expect(at(twoBombs, 19_024n)).toEqual(['BOMB_EXPLODE:h1', 'DEATH:h1', 'CHECKPOINT:h1', 'PANEL_OPEN:h1'])
  })

  test('an airborne horse passes over a bomb and the bomb stays', () => {
    const profiles = fixtureProfiles()
    profiles[3] = { base: 1_000n, acceleration: 10n, cap: 1_500n }
    const r = solvePaidCore(fixtureInput({ profiles, cpu: { 4: [24, 6, 25], 3: [1, 25, 26] } }))
    const laneThree = r.trace!.bombs.find((b) => b.lane === 3)!
    expect(r.events.some((e) => e.code === EV_BOMB_EXPLODE && e.horse === 3)).toBe(false)
    expect(laneThree.goneTau).toBeNull()
    const cross = r.trace!.keyframes[3]!.find((f) => f.pos < laneThree.pos && sampleHorse(r.trace!, 3, f.tau1).pos >= laneThree.pos)!
    expect(sampleStatus(r.trace!, 3, cross.tau1).airborne).toBe(true)
    expect(bombsAt(r.trace!, r.tauEnd)).toContainEqual(laneThree)
  })

  test('【目中无人】 ignores bombs placed by other horses', () => {
    const plain = solvePaidCore(fixtureInput({ cpu: { 4: [24, 6, 25] } }))
    expect(plain.events.some((e) => e.code === EV_BOMB_EXPLODE && e.horse === 1)).toBe(true)
    const pro = solvePaidCore(pickAt(fixtureInput({ playerDeck: deckWith(21), cpu: { 4: [24, 6, 25] } }), 1, 21))
    expect(pro.events.some((e) => e.code === EV_BOMB_EXPLODE && e.horse === 1)).toBe(false)
    expect(pro.trace!.bombs.find((b) => b.lane === 1)!.goneTau).toBeNull()
  })

  test('death clears the accumulated K', () => {
    const r = solvePaidCore(fixtureInput({ cpu: { 0: [2, 17, 25] } }))
    const death = r.events.find((e) => e.code === EV_DEATH && e.horse === 0)!
    const frames = r.trace!.keyframes[0]!
    expect(frames.find((f) => f.tau1 === death.tau)!.motion.fixed).toBe(10n)
    expect(frames.find((f) => f.tau0 === death.tau)!.motion).toMatchObject({ fixed: 0n, b: 0n })
  })
})

describe('C-09 swaps', () => {
  test('a finished target still consumes the attempt index', () => {
    const r = solvePaidCore(fixtureInput({ cpu: { 3: [24, 25, 9] } }))
    const blocked = r.events.find((e) => e.code === EV_SWAP_BLOCKED)!
    const target = Number(blocked.arg % 8n)
    expect(r.finishTime[target]).toBeLessThan(blocked.tau)
    const attempts = r.events.filter((e) => e.horse === 3 && (e.code === EV_SWAP || e.code === EV_SWAP_BLOCKED))
    expect(attempts.map((e) => e.arg / 8n)).toEqual(attempts.map((_, i) => BigInt(i)))
    // Attempts stop once the owner itself finishes.
    expect(attempts.at(-1)!.tau).toBeLessThan(r.finishTime[3]!)
    expect(attempts.at(-1)!.tau + 2_000n).toBeGreaterThan(r.finishTime[3]!)
  })

  test('an owner or target holding 【目中无人】 blocks the swap', () => {
    const owner = solvePaidCore(fixtureInput({ cpu: { 0: [21, 9, 25] } }))
    expect(owner.events.filter((e) => e.horse === 0 && e.code === EV_SWAP).length).toBe(0)
    expect(owner.events.filter((e) => e.horse === 0 && e.code === EV_SWAP_BLOCKED).length).toBeGreaterThan(10)
    const target = solvePaidCore(pickAt(fixtureInput({ playerDeck: deckWith(21), cpu: { 3: [9, 25, 26] } }), 1, 21))
    const hitsPlayer = target.events.filter((e) => e.horse === 3 && (e.code === EV_SWAP || e.code === EV_SWAP_BLOCKED)
      && e.arg % 8n === 1n && e.tau > 19_121n)
    expect(hitsPlayer.length).toBeGreaterThan(0)
    expect(hitsPlayer.every((e) => e.code === EV_SWAP_BLOCKED)).toBe(true)
  })

  test('a swap exchanges pos and lane, never dist, and never lands an unfinished horse past the line', () => {
    const r = solvePaidCore(pickAt(fixtureInput({ playerDeck: deckWith(9) }), 1, 9))
    const swaps = r.events.filter((e) => e.code === EV_SWAP)
    expect(swaps.length).toBeGreaterThan(5)
    const pre = (h: number, tau: bigint) => {
      const f = r.trace!.keyframes[h]!.find((k) => k.tau1 === tau && k.tau0 < tau)!
      const d = motionDelta(f.motion, tau - f.tau0)
      return { pos: f.pos + d, dist: f.dist + d, lane: f.lane }
    }
    for (const e of swaps) {
      const [a, b] = [e.horse, Number(e.arg % 8n)]
      const [preA, preB] = [pre(a, e.tau), pre(b, e.tau)]
      const [postA, postB] = [sampleHorse(r.trace!, a, e.tau), sampleHorse(r.trace!, b, e.tau)]
      expect([postA.pos, postA.lane, postB.pos, postB.lane]).toEqual([preB.pos, preB.lane, preA.pos, preA.lane])
      expect([postA.dist, postB.dist]).toEqual([preA.dist, preB.dist])
      expect(postA.pos < TRACK_MICRO && postB.pos < TRACK_MICRO).toBe(true)
    }
  })

  test('early finish: a swap to the front lets the player finish before later checkpoints', () => {
    const profiles = fixtureProfiles()
    profiles[0] = { base: 5_150n, acceleration: 0n, cap: 5_150n }
    const r = solvePaidCore(pickAt(fixtureInput({ profiles, playerDeck: deckWith(9) }), 1, 9, { anchor: fixtureAnchor(0) }))
    expect(r.events.find((e) => e.code === EV_SWAP)).toMatchObject({ horse: 1, arg: 0n, tau: 19_121n })
    expect(r.finishTime[1]).toBeLessThan(21_121n)
    expect(r.checkpoints.map((c) => c.reason)).toEqual(['picked', 'not-reached', 'not-reached'])
    expect(sampleHorse(r.trace!, 1, r.finishTime[1]!).dist).toBeLessThan(50_000_000_000n)
    expect(r.rawOrder[0]).toBe(1)
  })
})

describe('C-11 bursts, C-13 steal, C-12 wind', () => {
  test('stealing a wheel truncates the victim\'s bursts; the thief restarts a full 30 s life', () => {
    const r = solvePaidCore(fixtureInput({ cpu: { 0: [11, 25, 26], 2: [24, 13, 25] } }))
    const steal = r.events.find((e) => e.code === EV_STEAL)!
    expect(steal.horse).toBe(2)
    const victimBursts = r.events.filter((e) => e.code === EV_WHEEL_BURST && e.horse === 0)
    expect(victimBursts.length).toBe(2)
    expect(r.trace!.instances[0]).toMatchObject({ horse: 0, cardId: 11, endTau: steal.tau, endReason: 'stolen' })
    const loot = r.trace!.instances.find((i) => i.horse === 2 && i.cardId === 11)!
    expect(loot).toMatchObject({ startTau: steal.tau, plannedEndTau: steal.tau + 30_000n, slot: 2 })
    const thiefBursts = r.events.filter((e) => e.code === EV_WHEEL_BURST && e.horse === 2)
    expect(thiefBursts[0]!.tau).toBe(steal.tau + 7_000n)
    // K already earned by the victim stays with the victim.
    expect(r.trace!.keyframes[0]!.find((f) => f.tau0 === steal.tau)!.motion.fixed).toBe(20n)
    expect(sampleStatus(r.trace!, 0, steal.tau).airborne).toBe(false)
  })

  test('steal candidates are ordered by (holder, torso < tail < hooves) and indexed by entropy % n', () => {
    const cpu = { 0: [7, 25, 26], 2: [8, 25, 26], 3: [11, 25, 26] }
    const input = pickAt(pickAt(fixtureInput({ playerDeck: [22, 23, 24, 13, 25, 26, 20, 19, 1, 2, 6, 7, 8, 10], cpu }), 1, 0), 2, 13,
      { anchor: fixtureAnchor(0x52) })
    const r = solvePaidCore(input)
    const stealTau = r.events.find((e) => e.code === EV_STEAL)!.tau
    const offered = r.trace!.instances.filter((i) => i.kind === 'equip' && i.startTau < stealTau && i.horse !== 1)
      .sort((a, b) => a.horse - b.horse || a.slot - b.slot)
    expect(offered.map((i) => i.cardId)).toEqual([7, 8, 11])
    const pick = Number(chainEntropy(FIXTURE_SEED, fixtureAnchor(0x52), 2, PURPOSE_STEAL, 0n) % 3n)
    const stolen = offered[pick]!
    expect(r.events.find((e) => e.code === EV_STEAL)!.arg).toBe(BigInt(stolen.id))
    expect(r.events.find((e) => e.code === EV_EQUIP_OFF && e.tau === stealTau)).toMatchObject({ horse: stolen.horse, arg: BigInt(stolen.id) * 4n + 2n })
    expect(r.events.filter((e) => e.code === EV_EQUIP_ON && e.tau === stealTau && e.horse === 1).length).toBe(1)
  })

  test('same-slot equipment replaces the old instance without settling it', () => {
    const r = solvePaidCore(fixtureInput({ cpu: { 0: [7, 10, 25] } }))
    const rocket = r.trace!.instances.find((i) => i.cardId === 7)!
    const well = r.trace!.instances.find((i) => i.cardId === 10)!
    expect(rocket).toMatchObject({ endTau: well.startTau, endReason: 'replaced' })
    expect(r.events.find((e) => e.code === EV_EQUIP_OFF && e.arg === BigInt(rocket.id) * 4n + 1n)!.tau).toBe(well.startTau)
  })

  test('wind only moves airborne horses and a new wind replaces the old one', () => {
    const r = solvePaidCore(fixtureInput({ cpu: { 4: [12, 25, 26], 0: [1, 25, 26], 3: [24, 12, 25] } }))
    const winds = r.events.filter((e) => e.code === EV_WIND)
    expect(winds.map((e) => [e.horse, e.arg])).toEqual([[4, 1_000n], [3, -1_000n]])
    const [first, second] = winds
    expect(windAt(r.trace!, first!.tau - 1n)).toBeNull()
    expect(windAt(r.trace!, second!.tau)!.bps).toBe(-1_000n)
    const t = r.trace!
    expect(sampleHorse(t, 0, second!.tau - 1n).pBps).toBe(2_000n + 1_000n)
    expect(sampleHorse(t, 0, second!.tau).pBps).toBe(2_000n - 1_000n)
    expect(sampleHorse(t, 2, second!.tau).pBps).toBe(0n)
  })

  test('another horse\'s wind does not reach a 【目中无人】 holder, its own wind does', () => {
    const deck = [21, 22, 23, 11, 24, 25, 12, 26, 20, 19, 1, 2, 6, 7]
    let input = pickAt(fixtureInput({ playerDeck: deck, cpu: { 4: [12, 25, 26] } }), 1, 21)
    input = pickAt(pickAt(input, 2, 11), 3, 12, { anchor: fixtureAnchor(0x53) })
    const r = solvePaidCore(input)
    const own = r.events.find((e) => e.code === EV_WIND && e.horse === 1)!
    const wheelOn = r.trace!.instances.find((i) => i.horse === 1 && i.cardId === 11)!.startTau
    expect(sampleStatus(r.trace!, 1, wheelOn + 1n).airborne).toBe(true)
    expect(sampleHorse(r.trace!, 1, wheelOn + 1n).pBps).toBe(0n)
    const draw = chainEntropy(FIXTURE_SEED, fixtureAnchor(0x53), 3, PURPOSE_WIND, 0n) % 2n
    expect(own.arg).toBe(draw === 0n ? -1_000n : 1_000n)
    expect(sampleHorse(r.trace!, 1, own.tau).pBps).toBe(own.arg)
  })
})
