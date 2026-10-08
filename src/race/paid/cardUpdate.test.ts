import { expect, test } from 'bun:test'
import { EV_CARD, EV_DEATH, EV_EXHAUST_ENTER, EV_RESOURCE, EV_TRIGGER, EV_WHEEL_BURST } from './events.ts'
import { solvePaidCore } from './solver.ts'
import { playNewCards, fixtureInput } from './testkit.ts'
import { sampleHorse } from './trace.ts'
import { staminaAfter } from './motion.ts'
import { restoredStamina } from './resources.ts'

const H = 1
const profiles = (speed: bigint) => Array.from({ length: 5 }, () => ({ base: speed, acceleration: 0n, cap: speed }))
function run(ids: number[], speed = 1000n) { return solvePaidCore(playNewCards(ids, { profiles: profiles(speed) })) }
function at(r: ReturnType<typeof run>, id: number) { return r.events.find(e => e.code === EV_CARD && e.horse === H && e.arg === BigInt(id))!.tau }
function frame(r: ReturnType<typeof run>, tau: bigint) { return r.trace!.keyframes[H]!.filter(f => f.tau0 <= tau).at(-1)! }

test('C01 grants ten percent only for its twenty-second flight window', () => {
  const r = run([1]), t = at(r, 1)
  expect(sampleHorse(r.trace!, H, t).pBps).toBe(1000n)
  expect(sampleHorse(r.trace!, H, t + 19999n).pBps).toBe(1000n)
  expect(sampleHorse(r.trace!, H, t + 20000n).pBps).toBe(0n)
})

test('C22 gives its full extra-speed burst even when fewer than 300 stamina are paid', () => {
  const r = run([22], 450n), t = at(r, 22)
  const payment = r.events.find(e => e.code === EV_RESOURCE && e.horse === H && e.tau === t)!
  expect(payment.arg).toBeGreaterThan(-300000000n)
  expect(frame(r, t).motion.fixed).toBe(1000n)
  expect(sampleHorse(r.trace!, H, t).pBps).toBe(0n)
  expect(frame(r, t + 14000n).motion.fixed).toBe(0n)
})

test('direct stamina restoration adds the full amount above capacity', () => {
  expect(restoredStamina(1200000000n, 200000000n)).toBe(1400000000n)
})

test('wired keeps one full stamina point through depletion and subsequent recovery', () => {
  const sm = { s: 1000000n, exhausted: false, overcap: false, wired: true, cost: 24000n, regen: 10000n }
  expect(staminaAfter(sm, 10000n)).toBe(1000000n)
  expect(staminaAfter({ ...sm, cost: 0n }, 1000n)).toBe(11000000n)
})

test('C25 reaches a five-percent cost factor without changing speed', () => {
  const r = run([25]), t = at(r, 25)
  expect(frame(r, t).stamina.cost).toBe(1200n)
  expect(sampleHorse(r.trace!, H, t).pBps).toBe(0n)
  expect(frame(r, t + 20000n).stamina.cost).toBe(24000n)
})

test('C26 gives thirty percent and sixty-percent extra cost without a wired gate', () => {
  const r = run([26, 16]), t = at(r, 26), wired = at(r, 16)
  expect(frame(r, t).stamina.cost).toBe(38400n)
  expect(sampleHorse(r.trace!, H, t).pBps).toBe(3000n)
  if (wired < t + 20000n) expect(sampleHorse(r.trace!, H, wired).pBps).toBe(3000n)
})

test('C30 supplies stamina even without equipment and lasts twenty seconds', () => {
  const r = run([30]), t = at(r, 30)
  expect(r.events.find(e => e.code === EV_RESOURCE && e.horse === H && e.tau === t)!.arg).toBe(150000000n)
  expect(r.trace!.instances.find(i => i.cardId === 30 && i.horse === H)!.plannedEndTau).toBe(t + 20000n)
})

test('C31 snapshots each of two equipped slots as separate twenty-second speed buffs', () => {
  const r = run([7, 8, 31], 6000n), t = at(r, 31)
  expect(r.events.filter(e => e.code === EV_TRIGGER && e.horse === H && e.arg / 256n === 31n)).toHaveLength(2)
  const buffs = r.trace!.instances.filter(i => i.cardId === 31 && i.horse === H && i.kind === 'buff')
  expect(buffs).toHaveLength(2)
  expect(buffs.every(i => i.initialP === 1500n && i.plannedEndTau === t + 20000n)).toBe(true)
})

test('C38 intercepts its first exhaustion and supplies 250 stamina without entering exhaustion', () => {
  const r = run([38], 600n)
  const trigger = r.events.find(e => e.code === EV_TRIGGER && e.horse === H && e.arg / 256n === 38n)
  expect(trigger).toBeDefined()
  expect(r.events.some(e => e.code === EV_EXHAUST_ENTER && e.horse === H && e.tau === trigger!.tau)).toBe(false)
  expect(r.events.find(e => e.code === EV_RESOURCE && e.horse === H && e.tau === trigger!.tau)!.arg).toBe(250000000n)
  expect(sampleHorse(r.trace!, H, trigger!.tau).exhausted).toBe(false)
})

test('permanent fixed speed is multiplied with b rather than added as extra K', () => {
  const r = run([17, 1], 1800n), t = at(r, 1)
  expect(sampleHorse(r.trace!, H, t).b).toBe(1900000n)
  expect(sampleHorse(r.trace!, H, t).v).toBe(2090000n)
  expect(frame(r, t).motion.fixed).toBe(0n)
})

test('C40 tracks four private 14000-distance stages and replaces its own fixed-base contribution', () => {
  const r = run([40]), t = at(r, 40)
  expect(sampleHorse(r.trace!, H, t).b).toBe(800000n)
  const triggers = r.events.filter(e => e.code === EV_TRIGGER && e.horse === H && e.arg / 256n === 40n)
  expect(triggers).toHaveLength(4)
  for (const [k,e] of triggers.entries()) {
    expect(sampleHorse(r.trace!, H, e.tau).dist).toBeGreaterThanOrEqual(sampleHorse(r.trace!, H, t).dist + BigInt(k + 1) * 14000000000n)
    expect(frame(r, e.tau).motion.baseBonus).toBe(BigInt([100,300,500,1000][k]!))
  }
})

test('C24 waits through exactly 100 stamina and triggers below it once', () => {
  const r = solvePaidCore(playNewCards([24], {
    playerHorseId: 0, roster: [4,0,1,2,3],
    profiles: Array.from({ length: 5 }, () => ({ base: 300n, acceleration: 150n, cap: 1800n })),
  }))
  expect(sampleHorse(r.trace!, 0, 20000n).stamina).toBe(100000000n)
  const triggers = r.events.filter(e => e.code === EV_TRIGGER && e.horse === 0 && e.arg / 256n === 24n)
  expect(triggers).toHaveLength(1)
  expect(triggers[0]!.tau).toBe(20001n)
  expect(sampleHorse(r.trace!, 0, 20001n).stamina).toBe(299990000n)
})

test('C36 gives exactly 100 stamina to all five horses including a horse already finished', () => {
  const ps = profiles(1800n)
  ps[0] = { base: 10000n, acceleration: 0n, cap: 10000n }
  const r = solvePaidCore(playNewCards([36], { profiles: ps })), t = at(r, 36)
  expect(r.finishTime[0]).toBeLessThan(t)
  const resources = r.events.filter(e => e.code === EV_RESOURCE && e.tau === t)
  expect(resources.map(e => e.horse).sort()).toEqual([0,1,2,3,4])
  expect(resources.every(e => e.arg === 100000000n)).toBe(true)
})

test('C38 never rewards death or an exhaustion after its thirty-second window', () => {
  const r = run([38]), t = at(r, 38)
  expect(r.events.some(e => e.code === EV_EXHAUST_ENTER && e.horse === H && e.tau > t + 30000n)).toBe(true)
  expect(r.events.filter(e => e.code === EV_TRIGGER && e.horse === H && e.arg / 256n === 38n)).toHaveLength(0)
})

test('C11 starts with layer one, reaches layers eleven and twenty-one, and removes its extra speed at expiry', () => {
  const r = run([11]), t = at(r,11)
  for (const [dt,k] of [[0n,100n],[9999n,100n],[10000n,200n],[20000n,300n],[30000n,0n]])
    expect(frame(r,t+dt!).motion.fixed).toBe(k!)
})

test('death preserves fixed base speed without resetting card effects', () => {
  const r = solvePaidCore(fixtureInput({cpu:{0:[2,17,20]}}))
  const d=r.events.find(e=>e.code===EV_DEATH && e.horse===0)!
  expect(d).toBeDefined()
  const f=r.trace!.keyframes[0]!.find(f=>f.tau0===d.tau)!
  expect(f.motion).toMatchObject({baseBonus:100n,b:0n})
})

test('C29 counts obtained hair types and retains recovery when the second type grants speed', () => {
  for (const ids of [[19,29,20],[19,20,29],[29,19,20]]) {
    const r=run(ids), last=at(r,ids[2]!)
    expect(sampleHorse(r.trace!,H,last).pBps).toBe(20_000n)
    expect(frame(r,last).stamina.regen).toBe(25000n)
    if (ids[1]===29) {
      expect(sampleHorse(r.trace!,H,at(r,29)).pBps).toBe(0n)
      expect(frame(r,at(r,29)).stamina.regen).toBe(25000n)
    }
  }
})

test('C32 creates independent ten-percent buffs for each equipment full duration', () => {
  const r=run([7,8,32],3000n), t=at(r,32)
  const buffs=r.trace!.instances.filter(i=>i.cardId===32 && i.horse===H && i.kind==='buff')
  expect(buffs.map(i=>[i.initialP,i.plannedEndTau!-t])).toEqual([[1000n,20000n],[1000n,60000n]])
})

test('wired payment cannot remove its last stamina point and resource logs reflect actual payment', () => {
  const r=solvePaidCore(playNewCards([16,22],{
    playerHorseId:0,roster:[4,0,1,2,3],
    profiles:Array.from({length:5},()=>({base:300n,acceleration:150n,cap:1800n})),
  }))
  const t=r.events.find(e=>e.code===EV_CARD && e.horse===0 && e.arg===22n)!.tau
  expect(sampleHorse(r.trace!,0,t).stamina).toBe(1000000n)
  expect(r.events.find(e=>e.code===EV_RESOURCE && e.horse===0 && e.tau===t)!.arg).toBe(0n)
})

test('death preserves wheel extra speed, its original phase and the remaining equipment lifetime', () => {
  const r=solvePaidCore(fixtureInput({cpu:{0:[2,11,32]}}))
  const gear=r.trace!.instances.find(i=>i.horse===0&&i.cardId===11)!
  const d=r.events.find(e=>e.horse===0&&e.code===EV_DEATH)!
  expect(d.tau).toBeGreaterThan(gear.startTau)
  expect(d.tau).toBeLessThan(gear.endTau!)
  const f=r.trace!.keyframes[0]!.find(f=>f.tau0===d.tau)!
  expect(f.motion.fixed).toBe(200n)
  expect(r.events.filter(e=>e.horse===0&&e.code===EV_WHEEL_BURST).map(e=>[e.tau-gear.startTau,e.arg])).toEqual([[0n,1n],[10000n,11n],[20000n,21n]])
})

test('recycling refreshed equipment keeps C32 independent speed alive', () => {
  const r=run([8,32,30],3000n), t=at(r,30)
  const gear=r.trace!.instances.find(i=>i.horse===H&&i.cardId===8)!
  const buff=r.trace!.instances.find(i=>i.horse===H&&i.cardId===32&&i.kind==='buff')!
  expect(gear.endReason).toBe('recycled')
  expect(gear.endTau).toBe(t)
  expect(buff.endTau!).toBeGreaterThan(t)
  expect(sampleHorse(r.trace!,H,t).pBps).toBe(3500n)
})
