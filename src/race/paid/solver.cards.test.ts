import { describe, expect, test } from 'bun:test'
import { chainEntropy } from '../core/chainEntropy.ts'
import { PURPOSE_WIND, STAMINA_CAPACITY } from './constants.ts'
import {
  EV_BOMB_PLACE, EV_CARD, EV_CPU_CARD_CUT, EV_DEATH, EV_EXPIRE, EV_STEAL_NONE, EV_SWAP, EV_SWAP_BLOCKED,
  EV_WHEEL_BURST, EV_WIND,
} from './events.ts'
import { solvePaidCore, type PaidSolveResult } from './solver.ts'
import { FIXTURE_ANCHOR, FIXTURE_SEED, fixtureAnchor, fixtureInput, pickAt, QUIET_DECK } from './testkit.ts'
import { bombsAt, sampleHorse, sampleStatus, type PaidTraceInstance } from './trace.ts'

const PLAYER = 1
const CPU = 0
const PICK_ANCHOR = fixtureAnchor(0x31)
const quietResult = solvePaidCore(fixtureInput())

type Ctx = { r: PaidSolveResult; horse: number; tau: bigint; asPlayer: boolean }

function onPlayer(cardId: number): Ctx {
  const deck = [cardId, ...QUIET_DECK.filter((c) => c !== cardId)].slice(0, 14)
  const r = solvePaidCore(pickAt(fixtureInput({ playerDeck: deck }), 1, cardId, { anchor: PICK_ANCHOR }))
  return { r, horse: PLAYER, tau: cardTau(r, PLAYER, cardId), asPlayer: true }
}

function onCpu(cardId: number): Ctx {
  const rest = [19, 20, 5].filter((c) => c !== cardId).slice(0, 2)
  const r = solvePaidCore(fixtureInput({ cpu: { [CPU]: [cardId, ...rest] } }))
  return { r, horse: CPU, tau: cardTau(r, CPU, cardId), asPlayer: false }
}

function cardTau(r: PaidSolveResult, horse: number, cardId: number): bigint {
  const e = r.events.find((ev) => ev.code === EV_CARD && ev.horse === horse && ev.arg === BigInt(cardId))
  if (!e) throw new Error(`card ${cardId} not applied`)
  return e.tau
}

function instancesOf(ctx: Ctx, cardId: number): PaidTraceInstance[] {
  return ctx.r.trace!.instances.filter((i) => i.horse === ctx.horse && i.cardId === cardId && i.kind !== 'bonus')
}

const checks: Record<number, (ctx: Ctx) => void> = {
  1: (ctx) => {
    const [inst] = instancesOf(ctx, 1)
    expect(inst).toMatchObject({ kind: 'buff', startTau: ctx.tau, plannedEndTau: ctx.tau + 30_000n })
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau).airborne).toBe(true)
    expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).pBps).toBe(2_000n)
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau + 30_000n).airborne).toBe(false)
  },
  2: (ctx) => {
    const death = ctx.r.events.find((e) => e.code === EV_DEATH && e.horse === ctx.horse)!
    expect(death.tau).toBe(ctx.tau + 30_000n)
    expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau + 1n).pBps).toBe(3_000n)
    expect(sampleHorse(ctx.r.trace!, ctx.horse, death.tau).b).toBe(0n)
    expect(sampleStatus(ctx.r.trace!, ctx.horse, death.tau + 4_999n).respawning).toBe(true)
    expect(sampleStatus(ctx.r.trace!, ctx.horse, death.tau + 5_000n).respawning).toBe(false)
  },
  3: (ctx) => {
    expect(instancesOf(ctx, 3)[0]!.plannedEndTau).toBe(ctx.tau + 20_000n)
    expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).pBps).toBe(4_000n)
    if (ctx.asPlayer) expect(ctx.r.checkpoints.slice(1).map((c) => c.reason)).toEqual(['cut', 'cut'])
    else expect(ctx.r.events.filter((e) => e.code === EV_CPU_CARD_CUT && e.horse === ctx.horse).length).toBe(2)
  },
  4: (ctx) => {
    if (ctx.asPlayer) expect(ctx.r.checkpoints.slice(1).map((c) => c.mode)).toEqual(['auto', 'auto'])
    const bonuses = ctx.r.trace!.instances.filter((i) => i.horse === ctx.horse && i.kind === 'bonus')
    expect(bonuses.length).toBe(2)
    expect(bonuses.every((b) => b.startTau > ctx.tau)).toBe(true)
  },
  5: (ctx) => {
    if (ctx.asPlayer) {
      const stop = solvePaidCore(pickAt(fixtureInput({ playerDeck: [5, ...QUIET_DECK.filter((c) => c !== 5)].slice(0, 14) }), 1, 5),
        { stopAtPanel: 2 })
      expect(stop.panel!.drawState.refreshCredits).toBe(1)
    } else {
      expect(ctx.r.finishTime).toEqual(quietResult.finishTime)
    }
  },
  6: (ctx) => {
    const places = ctx.r.events.filter((e) => e.code === EV_BOMB_PLACE && e.horse === ctx.horse)
    const pos = sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).pos
    expect(places.map((e) => e.arg % 8n)).toEqual([0n, 1n, 2n, 3n, 4n].filter((l) => l !== BigInt(ctx.horse)))
    expect(places.every((e) => e.arg / 8n === pos && e.tau === ctx.tau)).toBe(true)
    expect(ctx.r.trace!.bombs.map((b) => b.placer)).toEqual([ctx.horse, ctx.horse, ctx.horse, ctx.horse])
  },
  7: (ctx) => {
    expect(instancesOf(ctx, 7)[0]).toMatchObject({ kind: 'equip', slot: 0, plannedEndTau: ctx.tau + 40_000n })
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau).equipment.torso).toBe(7)
    const frame = ctx.r.trace!.keyframes[ctx.horse]!.find((f) => f.tau0 === ctx.tau)!
    expect(frame.stamina.cost).toBe(12_000n)
    expect(frame.pBps).toBe(1_500n)
  },
  8: (ctx) => {
    expect(instancesOf(ctx, 8)[0]).toMatchObject({ kind: 'equip', slot: 1, plannedEndTau: ctx.tau + 60_000n })
    expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).pBps).toBe(1_000n)
  },
  9: (ctx) => {
    const attempts = ctx.r.events.filter((e) => (e.code === EV_SWAP || e.code === EV_SWAP_BLOCKED) && e.horse === ctx.horse)
    expect(attempts.length).toBe(15)
    expect(attempts.map((e) => e.tau)).toEqual(Array.from({ length: 15 }, (_, i) => ctx.tau + 2_000n * BigInt(i)))
    expect(attempts.map((e) => e.arg / 8n)).toEqual(Array.from({ length: 15 }, (_, i) => BigInt(i)))
    const expiry = ctx.r.events.find((e) => e.code === EV_EXPIRE && e.horse === ctx.horse)!
    expect(expiry.tau).toBe(ctx.tau + 30_000n)
  },
  10: (ctx) => {
    expect(instancesOf(ctx, 10)[0]).toMatchObject({ kind: 'equip', slot: 0, plannedEndTau: ctx.tau + 10_000n })
    expect(ctx.r.stepCount).toBeGreaterThanOrEqual(200)
  },
  11: (ctx) => {
    const bursts = ctx.r.events.filter((e) => e.code === EV_WHEEL_BURST && e.horse === ctx.horse)
    expect(bursts.map((e) => [e.tau - ctx.tau, e.arg])).toEqual([[7_000n, 1n], [14_000n, 2n], [21_000n, 3n], [28_000n, 4n]])
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau + 1n)).toMatchObject({ airborne: true, equipment: { hooves: 11 } })
    const fixedAt = (tau: bigint) => ctx.r.trace!.keyframes[ctx.horse]!.find((f) => f.tau0 === tau)!.motion.fixed
    expect(fixedAt(ctx.tau + 7_000n)).toBe(10n)
    expect(fixedAt(ctx.tau + 28_000n)).toBe(40n)
  },
  12: (ctx) => {
    const draw = ctx.asPlayer
      ? chainEntropy(FIXTURE_SEED, PICK_ANCHOR, 1, PURPOSE_WIND, 0n)
      : chainEntropy(FIXTURE_SEED, FIXTURE_ANCHOR, 0, PURPOSE_WIND, BigInt(CPU * 3))
    const wind = ctx.r.events.find((e) => e.code === EV_WIND)!
    expect(wind).toMatchObject({ horse: ctx.horse, tau: ctx.tau, arg: draw % 2n === 0n ? -1_000n : 1_000n })
    // Nobody is airborne, so the environment changes nothing.
    expect(ctx.r.finishTime).toEqual(quietResult.finishTime)
  },
  13: (ctx) => {
    expect(ctx.r.events.find((e) => e.code === EV_STEAL_NONE)).toMatchObject({ horse: ctx.horse, tau: ctx.tau })
  },
  14: (ctx) => {
    const frame = ctx.r.trace!.keyframes[ctx.horse]!.find((f) => f.tau0 === ctx.tau)!
    expect(frame.stamina.regen).toBe(20_000n)
    const after = ctx.r.trace!.keyframes[ctx.horse]!.find((f) => f.tau0 === ctx.tau + 5_000n)!
    expect(after.stamina.regen).toBe(10_000n)
  },
  15: (ctx) => {
    expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).stamina).toBe(STAMINA_CAPACITY - 14_000n * ctx.tau + 200_000_000n)
  },
  16: (ctx) => {
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau + 9_999n).wired).toBe(true)
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau + 10_000n).wired).toBe(false)
  },
  17: (ctx) => expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).v - sampleHorse(quietResult.trace!, ctx.horse, ctx.tau).v)
    .toBe(10_000n),
  18: (ctx) => expect(sampleHorse(ctx.r.trace!, ctx.horse, ctx.tau).v - sampleHorse(quietResult.trace!, ctx.horse, ctx.tau).v)
    .toBe(20_000n),
  21: (ctx) => {
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau).blindedPro).toBe(true)
    expect(sampleStatus(ctx.r.trace!, ctx.horse, ctx.tau - 1n).blindedPro).toBe(false)
    expect(ctx.r.trace!.keyframes[ctx.horse]!.find((f) => f.tau0 === ctx.tau)!.motion.fixed).toBe(10n)
  },
}

const NO_EFFECT = [19, 20]

// C-22..C-40 are covered in newCards.test.ts.
describe('C-01..C-21 on the player and on a CPU', () => {
  for (let cardId = 1; cardId <= 21; cardId++) {
    for (const who of ['player', 'cpu'] as const) {
      test(`C-${String(cardId).padStart(2, '0')} on ${who}`, () => {
        const ctx = who === 'player' ? onPlayer(cardId) : onCpu(cardId)
        if (NO_EFFECT.includes(cardId)) {
          expect(ctx.r.finishTime).toEqual(quietResult.finishTime)
          expect(ctx.r.trace!.instances.length).toBe(0)
          return
        }
        checks[cardId]!(ctx)
        if (ctx.asPlayer) expect(ctx.r.acquired[0]).toBe(cardId)
        expect(bombsAt(ctx.r.trace!, 0n)).toEqual([])
      })
    }
  }
})
