import { expect, test } from 'bun:test'
import { RK_STEP_MS } from './constants.ts'
import { EV_EQUIP_OFF, EV_EQUIP_ON, EV_FINISH, PAID_EVENT_NAMES } from './events.ts'
import { motionDelta, multiplierOf, wellFieldBps } from './motion.ts'
import { solvePaidCore, type PaidSolveResult } from './solver.ts'
import { fixtureInput, fixtureProfiles } from './testkit.ts'
import { sampleHorse, type PaidKeyframe } from './trace.ts'

function wellWindows(r: PaidSolveResult): { owner: number; from: bigint; to: bigint }[] {
  return r.trace!.instances.filter((i) => i.cardId === 10 && i.kind === 'equip')
    .map((i) => ({ owner: i.horse, from: i.startTau, to: i.endTau ?? r.tauEnd }))
}

function frameAt(r: PaidSolveResult, h: number, tau: bigint): PaidKeyframe | undefined {
  return r.trace!.keyframes[h]!.find((f) => f.tau0 === tau && !f.finished && f.tau1 > f.tau0)
}

/** Independent re-implementation of one frozen RK2 midpoint step (spec 「重力井数值积分」). */
function checkRk2Step(r: PaidSolveResult, tau: bigint): number {
  const owners = wellWindows(r).filter((w) => w.from <= tau && tau < w.to).map((w) => w.owner)
  const frames = [0, 1, 2, 3, 4].map((h) => frameAt(r, h, tau))
  const running = [0, 1, 2, 3, 4].filter((h) => frames[h] !== undefined)
  const pos = frames.map((f) => f?.pos ?? 0n)
  const field = (at: bigint[], h: number) => owners.filter((o) => o !== h).reduce((sum, o) => sum + wellFieldBps(at[o]!, at[h]!), 0n)
  const dt = frames[running[0]!]!.tau1 - tau
  const mid = [...pos]
  for (const h of running) mid[h] = pos[h]! + motionDelta({ ...frames[h]!.motion, mult: multiplierOf(field(pos, h)) }, dt / 2n)
  for (const h of running) {
    const pm = field(mid, h)
    expect(frames[h]!.pBps).toBe(pm)
    expect(frames[h]!.motion.mult).toBe(multiplierOf(pm))
    expect(frames[h]!.tau1).toBe(tau + dt)
    expect(sampleHorse(r.trace!, h, tau + dt).dist).toBe(frames[h]!.dist + motionDelta(frames[h]!.motion, dt))
  }
  return running.length
}

test('one well: every full 50 ms step equals the frozen RK2 midpoint rule', () => {
  const r = solvePaidCore(fixtureInput({ cpu: { 2: [10, 20, 5] } }))
  const [well] = wellWindows(r)
  expect(well).toMatchObject({ owner: 2, to: well!.from + 10_000n })
  const steps = r.trace!.keyframes[2]!.filter((f) => f.tau0 >= well!.from && f.tau0 < well!.to)
  expect(steps.every((f) => f.tau1 - f.tau0 <= RK_STEP_MS)).toBe(true)
  expect(r.stepCount).toBe(steps.length)
  const full = steps.filter((f) => f.tau1 - f.tau0 === RK_STEP_MS)
  expect(full.length).toBeGreaterThan(150)
  for (const f of full.slice(0, 40)) expect(checkRk2Step(r, f.tau0)).toBe(5)
  // Outside the well the solver is analytic again: intervals longer than one step reappear.
  expect(r.trace!.keyframes[2]!.some((f) => f.tau0 >= well!.to && f.tau1 - f.tau0 > RK_STEP_MS)).toBe(true)
})

test('field sign: horses ahead of the owner are slowed, horses behind are pulled along', () => {
  const r = solvePaidCore(fixtureInput({ cpu: { 2: [10, 20, 5] } }))
  const [well] = wellWindows(r)
  let ahead = 0
  let behind = 0
  for (const f of r.trace!.keyframes[2]!.filter((k) => k.tau0 >= well!.from && k.tau0 < well!.to)) {
    for (const h of [0, 1, 3, 4]) {
      const other = frameAt(r, h, f.tau0)
      if (!other || other.pBps === 0n) continue
      if (other.pos > f.pos + 100_000_000n) {
        expect(other.pBps).toBeLessThan(0n)
        ahead++
      }
      if (other.pos < f.pos - 100_000_000n) {
        expect(other.pBps).toBeGreaterThan(0n)
        behind++
      }
    }
  }
  expect(ahead).toBeGreaterThan(0)
  expect(behind).toBeGreaterThan(0)
})

test('overlapping wells sum; each owner feels the other well but not its own', () => {
  const r = solvePaidCore(fixtureInput({ cpu: { 0: [10, 20, 5], 2: [10, 20, 5], 3: [19, 10, 20] } }))
  const windows = wellWindows(r)
  expect(windows.map((w) => w.owner)).toEqual([2, 0, 3])
  const overlap = windows[1]!.from + 1_000n
  const f = r.trace!.keyframes[0]!.find((k) => k.tau0 >= overlap && k.tau1 - k.tau0 === RK_STEP_MS)!
  expect(checkRk2Step(r, f.tau0)).toBe(5)
})

test('the field stops when its owner finishes; finished targets are not computed', () => {
  const profiles = fixtureProfiles()
  profiles[0] = { base: 3_000n, acceleration: 0n, cap: 3_000n }
  const r = solvePaidCore(fixtureInput({ profiles, cpu: { 0: [19, 20, 10] } }))
  const on = r.events.find((e) => e.code === EV_EQUIP_ON)!
  const finish = r.events.find((e) => e.code === EV_FINISH && e.horse === 0)!
  expect(finish.tau).toBeLessThan(on.tau + 10_000n)
  expect(r.events.some((e) => e.code === EV_EQUIP_OFF)).toBe(false)
  expect(r.trace!.instances[0]).toMatchObject({ endTau: finish.tau, endReason: 'finished' })
  expect(r.stepCount).toBe(Number((finish.tau - on.tau + RK_STEP_MS - 1n) / RK_STEP_MS))
  const after = r.trace!.keyframes[1]!.filter((f) => f.tau0 >= finish.tau && f.tau0 < on.tau + 10_000n)
  expect(after.every((f) => f.pBps === 0n)).toBe(true)
  expect(after.some((f) => f.tau1 - f.tau0 > RK_STEP_MS)).toBe(true)
})

test('an expiring well ends at its canonical ms before same-ms finishes (class 0 before class 2)', () => {
  const profiles = fixtureProfiles()
  profiles[0] = { base: 2_500n, acceleration: 0n, cap: 2_500n }
  const r = solvePaidCore(fixtureInput({ profiles, cpu: { 0: [19, 20, 10] } }))
  expect(r.events.filter((e) => e.tau === 40_000n).map((e) => PAID_EVENT_NAMES[e.code])).toEqual(['EQUIP_OFF', 'FINISH'])
})
