import { describe, expect, test } from 'bun:test'
import { PAID_CARD_RULES, paidCardRule } from './cardRules.ts'
import { derivePaidCpuDeck } from '../core/paidCpuDeck.ts'
import { derivePaidDeck } from '../core/paidDeck.ts'
import { EV_CARD, EV_DEATH, EV_WHEEL_BURST } from './events.ts'
import { motionDelta, speedAt } from './motion.ts'
import { solvePaidCore, type PaidSolveResult } from './solver.ts'
import { FIXTURE_SEED, playNewCards, type FixtureOverrides } from './testkit.ts'
import { sampleHorse, sampleStatus } from './trace.ts'

const H = 1
const TRIGGER = 29, RESOURCE = 30, GUARD = 31, TARGET = 32, RENEW = 33
function played(ids: number[], overrides: FixtureOverrides = {}): PaidSolveResult {
  return solvePaidCore(playNewCards(ids, overrides))
}
function start(r: PaidSolveResult, id: number, h = H): bigint {
  return r.events.find((e) => e.code === EV_CARD && e.horse === h && e.arg === BigInt(id))!.tau
}
function frame(r: PaidSolveResult, tau: bigint, h = H) {
  return r.trace!.keyframes[h]!.filter((f) => f.tau0 <= tau).at(-1)!
}
function triggers(r: PaidSolveResult, id: number, h = H) {
  return r.events.filter((e) => e.code === TRIGGER && e.horse === h && e.arg / 256n === BigInt(id))
}
const slow = Array.from({ length: 5 }, () => ({ base: 1000n, acceleration: 0n, cap: 1000n }))

describe('40-card production pool', () => {
  test('all nineteen approved cards are effects; CPU can derive new IDs but not player-only cards', () => {
    expect(PAID_CARD_RULES).toHaveLength(40)
    for (let id = 22; id <= 40; id++) expect(paidCardRule(id).effect).not.toBe('none')
    const seen = new Set<number>()
    for (let n = 1; n <= 100; n++) {
      const anchor = `0x${n.toString(16).padStart(64, '0')}` as const
      const player = derivePaidDeck(FIXTURE_SEED, anchor)
      expect(new Set(player).size).toBe(14)
      for (const id of derivePaidCpuDeck(FIXTURE_SEED, anchor, 0)) {
        expect(paidCardRule(id).cpu).toBe(true)
        expect([29, 39]).not.toContain(id)
        seen.add(id)
      }
    }
    expect([...seen].some((id) => id > 26)).toBe(true)
  })
  test('negative fixed speed clips motion at zero, not negative mileage', () => {
    const m = { exhausted: false, b: 0n, aEff: 1n, mult: 10000n, fixed: -20n }
    expect(motionDelta(m, 10_000n)).toBe(0n)
    expect(motionDelta(m, 30_000n)).toBe(50_000_000n)
    expect(speedAt(m, 100_000n, 10_000n)).toBe(0n)
  })
})

describe('C-22..C-40 actual race effects', () => {
  test('C-22 spends stamina once and expires its proportional burst', () => {
    const r = played([22]), t = start(r, 22)
    const payment = r.events.find((e) => e.code === RESOURCE && e.horse === H && e.tau === t)!
    expect(payment.arg).toBe(-300_000_000n)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(3500n)
    expect(sampleHorse(r.trace!, H, t + 12_000n).pBps).toBe(0n)
  })
  test('C-23 switches exactly at six sim seconds', () => {
    const r = played([23]), t = start(r, 23)
    expect(sampleHorse(r.trace!, H, t + 5999n).pBps).toBe(-1500n)
    expect(frame(r, t).stamina.regen).toBe(30_000n)
    expect(sampleHorse(r.trace!, H, t + 6000n).pBps).toBe(3000n)
    expect(frame(r, t + 6000n).stamina.regen).toBe(10_000n)
    expect(triggers(r, 23)).toHaveLength(1)
  })
  test('C-24 consumes its resource threshold once after a stamina payment', () => {
    const r = played([22, 24], { profiles: slow })
    expect(triggers(r, 24)).toHaveLength(1)
    expect(r.events.filter((e) => e.code === RESOURCE && e.horse === H && e.arg === 300_000_000n)).toHaveLength(1)
  })
  test('C-25 and rocket use one additive cost factor', () => {
    const r = played([7, 25]), t = start(r, 25)
    expect(frame(r, t).stamina.cost).toBe(2400n)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(1000n)
  })
  test('C-26 wired gate adds only ten percent; rocket offsets its cost surcharge', () => {
    const r = played([7, 26, 16]), t = start(r, 16)
    expect(frame(r, start(r, 26)).stamina.cost).toBe(24_000n)
    if (t < start(r, 26) + 20_000n) expect(sampleHorse(r.trace!, H, t).pBps).toBe(5000n)
    else throw new Error('fixture must overlap rage and wired')
  })
  test('C-27 reads airborne state from either source, without producing it', () => {
    const alone = played([27]), t = start(alone, 27)
    expect(sampleHorse(alone.trace!, H, t).pBps).toBe(500n)
    expect(sampleStatus(alone.trace!, H, t).airborne).toBe(false)
    const r = played([1, 27]), u = start(r, 27)
    expect(sampleHorse(r.trace!, H, u).pBps).toBe(4000n)
  })
  test('C-28 closes its ground gate while airborne', () => {
    const r = played([28, 1]), t = start(r, 1)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(2000n)
  })
  test('C-29 current coat branches are exclusive and update after a dye', () => {
    const r = played([19, 29, 20]), t = start(r, 29), u = start(r, 20)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(1500n)
    expect(sampleHorse(r.trace!, H, u).pBps).toBe(0n)
    expect(frame(r, u).stamina.regen).toBe(25_000n)
  })
  test('C-30 recycles shortest remaining equipment, leaving the other slot', () => {
    const r = played([7, 8, 30]), t = start(r, 30)
    expect(sampleStatus(r.trace!, H, t).equipment).toMatchObject({ torso: 0, tail: 8 })
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(3500n)
    expect(r.trace!.instances.find((i) => i.cardId === 7 && i.horse === H)!.endReason).toBe('recycled')
  })
  test('C-31 reacts to actual equipment acquisition and not render sampling', () => {
    const r = played([31, 8, 7])
    expect(triggers(r, 31)).toHaveLength(2)
    expect(sampleHorse(r.trace!, H, start(r, 8)).pBps).toBe(2500n)
  })
  test('C-32 renews expiry, preserving wheel phase and extending its finite bursts', () => {
    const r = played([11, 32], { profiles: slow }), t = start(r, 11), u = start(r, 32)
    const bursts = r.events.filter((e) => e.code === EV_WHEEL_BURST && e.horse === H)
    expect(r.events.filter((e) => e.code === RENEW && e.horse === H)).toHaveLength(1)
    expect(bursts.length).toBeGreaterThan(4)
    expect(bursts.every((e) => (e.tau - t) % 7000n === 0n && e.tau < u + 30_000n)).toBe(true)
  })
  test('C-33 checks tail/hooves as well as torso', () => {
    const r = played([33, 8]), t = start(r, 8)
    expect(sampleHorse(r.trace!, H, start(r, 33)).pBps).toBe(2500n)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(500n)
  })
  test('C-34 selects the nearest eligible opponent without a range cap', () => {
    const profiles = slow.map((p) => ({ ...p }))
    profiles[0] = { base: 1600n, acceleration: 0n, cap: 1600n }
    const r = played([34], { profiles }), t = start(r, 34)
    expect(r.events.find((e) => e.code === TARGET && e.horse === H)!.arg).toBe(0n)
    expect(sampleHorse(r.trace!, 0, t).pBps).toBe(-2000n)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(500n)
  })
  test('C-35 uses current physical order, including horseId tie breaking', () => {
    const r = played([35], { profiles: slow }), t = start(r, 35)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(800n)
    const profiles = slow.map((p) => ({ ...p }))
    profiles[H] = { base: 1600n, acceleration: 0n, cap: 1600n }
    const leading = played([35], { profiles })
    expect(sampleHorse(leading.trace!, H, start(leading, 35)).pBps).toBe(2500n)
  })
  test('C-36 supplies every unfinished horse and clips at capacity', () => {
    const r = played([36]), t = start(r, 36)
    expect(r.events.filter((e) => e.code === RESOURCE && e.tau === t)).toHaveLength(5)
    expect(sampleHorse(r.trace!, H, t).pBps).toBe(1500n)
    for (let h = 0; h < 5; h++) expect(sampleHorse(r.trace!, h, t).stamina).toBeLessThanOrEqual(1_000_000_000n)
  })
  test('C-37 guards one actual death permanently, with no immediate speed', () => {
    const r = played([2, 37])
    expect(r.events.filter((e) => e.code === GUARD && e.horse === H)).toHaveLength(1)
    expect(r.events.filter((e) => e.code === EV_DEATH && e.horse === H)).toHaveLength(0)
    expect(sampleHorse(r.trace!, H, start(r, 37)).pBps).toBe(3000n)
  })
  test('C-38 reacts after death clear and grants a separately expiring fixed contribution', () => {
    const r = played([2, 38]), d = r.events.find((e) => e.code === EV_DEATH && e.horse === H)!
    expect(triggers(r, 38)).toHaveLength(1)
    expect(frame(r, d.tau).motion.fixed).toBe(120n)
    expect(frame(r, d.tau + 30_000n).motion.fixed).toBe(0n)
  })
  test('C-39 rewards a future active forfeit, not a timeout', () => {
    const active = played([39, 0]), timed = played([39])
    expect(sampleHorse(active.trace!, H, start(active, 39)).pBps).toBe(-1000n)
    expect(triggers(active, 39)).toHaveLength(1)
    expect(triggers(timed, 39)).toHaveLength(0)
  })
  test('C-40 starts in debt and grows on own mileage, once per twenty percent', () => {
    const r = played([40]), t = start(r, 40)
    expect(frame(r, t).motion.fixed).toBe(-20n)
    const awards = triggers(r, 40)
    expect(awards).toHaveLength(3)
    for (let k = 0; k < awards.length; k++) {
      expect(sampleHorse(r.trace!, H, awards[k]!.tau).dist).toBeGreaterThanOrEqual(sampleHorse(r.trace!, H, t).dist + BigInt(k + 1) * 20_000_000_000n)
      expect(frame(r, awards[k]!.tau).motion.fixed).toBe(-20n + BigInt(k + 1) * 30n)
    }
  })
})

describe('new-card lifecycle boundaries', () => {
  test('C-24 expires its listener before a later stamina threshold', () => {
    const r = played([24], { profiles: slow })
    expect(triggers(r,24)).toHaveLength(0)
    expect(r.trace!.instances.find(i=>i.cardId===24&&i.kind==='watch')!.endReason).toBe('expired')
  })
  test('C-27 grants its airborne bonus once even with two active flight sources', () => {
    const fast = Array.from({length:5},()=>({base:3000n,acceleration:0n,cap:3000n}))
    const r=played([1,11,27],{profiles:fast}), t=start(r,27)
    expect(sampleStatus(r.trace!,H,t).airborne).toBe(true)
    expect(sampleHorse(r.trace!,H,t).pBps).toBe(4000n)
  })
  test('C-30 fallback uses ten seconds rather than the recycling duration', () => {
    const r=played([30]), t=start(r,30)
    expect(sampleHorse(r.trace!,H,t).pBps).toBe(1000n)
    expect(r.trace!.instances.find(i=>i.cardId===30)!.plannedEndTau).toBe(t+10000n)
    expect(r.events.filter(e=>e.code===RESOURCE)).toHaveLength(0)
  })
  test('C-31 does not treat an equipment refresh as another acquisition', () => {
    const r=played([31,7,32])
    expect(triggers(r,31)).toHaveLength(1)
    expect(r.events.some(e=>e.code===RENEW)).toBe(true)
  })
  test('C-36 preserves adrenaline overcap instead of clipping it back to capacity', () => {
    const fast = Array.from({length:5},()=>({base:6000n,acceleration:0n,cap:6000n}))
    const r=played([15,36], {profiles:fast}), t=start(r,36)
    expect(sampleHorse(r.trace!,H,t).stamina).toBeGreaterThan(1000000000n)
    expect(r.events.find(e=>e.code===RESOURCE&&e.horse===H&&e.tau===t)!.arg).toBe(0n)
  })
  test('C-38 ignores an actual death after its fifty-second listener ends', () => {
    const r=played([38,2],{profiles:slow})
    const d=r.events.find(e=>e.code===EV_DEATH&&e.horse===H)!
    expect(d.tau).toBeGreaterThanOrEqual(start(r,38)+50000n)
    expect(triggers(r,38)).toHaveLength(0)
    expect(frame(r,d.tau).motion.fixed).toBe(0n)
  })
  test('C-39 acquired at the third checkpoint has no future choice to reward', () => {
    const r=played([19,20,39])
    expect(triggers(r,39)).toHaveLength(0)
  })
  test('C-40 later acquisition leaves two or one mileage rewards before the finish', () => {
    expect(triggers(played([19,40],{profiles:slow}),40)).toHaveLength(2)
    expect(triggers(played([19,20,40],{profiles:slow}),40)).toHaveLength(1)
  })
  test('C-40 swap jumps never count as mileage or restart the consumed steps', () => {
    const r=played([40,9]), t=start(r,40), events=triggers(r,40)
    expect(events.length).toBeGreaterThan(0)
    expect(events.length).toBeLessThanOrEqual(4)
    events.forEach((e,k)=>expect(sampleHorse(r.trace!,H,e.tau).dist).toBeGreaterThanOrEqual(sampleHorse(r.trace!,H,t).dist+BigInt(k+1)*20000000000n))
    expect(r.trace!.keyframes[H]!.some(f=>f.pos!==f.dist)).toBe(true)
  })
})

test('guard interception does not reward a death, but a second bomb at the same instant does', () => {
 const profiles=slow.map(p=>({...p}));profiles[0]={base:1300n,acceleration:0n,cap:1300n};profiles[2]={base:1300n,acceleration:0n,cap:1300n}
 const blocked=played([37,38],{profiles,cpu:{0:[19,20,6]}})
 expect(blocked.events.filter(e=>e.code===GUARD&&e.horse===H)).toHaveLength(1)
 expect(blocked.events.filter(e=>e.code===EV_DEATH&&e.horse===H)).toHaveLength(0)
 expect(triggers(blocked,38)).toHaveLength(0)
 const second=played([37,38],{profiles,cpu:{0:[19,20,6],2:[19,20,6]}})
 const guard=second.events.find(e=>e.code===GUARD&&e.horse===H)!, death=second.events.find(e=>e.code===EV_DEATH&&e.horse===H)!
 expect(death.tau).toBe(guard.tau)
 expect(triggers(second,38)).toHaveLength(1)
 expect(frame(second,death.tau).motion.fixed).toBe(120n)
})

test('tinker snapshots a tail-only loadout and target debuffs survive immunity acquired later', () => {
 const loaded=played([8,31,11])
 expect(triggers(loaded,31)).toHaveLength(2)
 const profiles=slow.map(p=>({...p}));profiles[0]={base:1800n,acceleration:0n,cap:1800n}
 const r=played([34],{profiles,cpu:{0:[19,21,20]}}), blind=start(r,21,0)
 expect(blind).toBeLessThan(start(r,34)+8000n)
 expect(sampleHorse(r.trace!,0,blind).pBps).toBe(-2000n)
})
