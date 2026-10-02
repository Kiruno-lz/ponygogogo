import { expect, test } from 'bun:test'
import { STAMINA_CAPACITY } from './constants.ts'
import {
  EV_BASE_CAP, EV_CARD, EV_EXHAUST_ENTER, EV_EXHAUST_EXIT, EV_EXPIRE, EV_OVERCAP_END, PAID_EVENT_NAMES,
} from './events.ts'
import { ceilDiv, exhaustedSpeed } from './motion.ts'
import { solvePaidCore, type PaidCoreProfile, type PaidSolveResult } from './solver.ts'
import { fixtureInput, fixtureProfiles } from './testkit.ts'
import { sampleHorse, sampleStatus } from './trace.ts'

const H = 0
const DRAIN = 14_000n
const REGEN = 10_000n

function cpuRace(profile: PaidCoreProfile, deck: number[]): PaidSolveResult {
  const profiles = fixtureProfiles()
  profiles[H] = profile
  return solvePaidCore(fixtureInput({ profiles, cpu: { [H]: deck } }))
}

function log(r: PaidSolveResult): string[] {
  return r.events.filter((e) => e.horse === H && e.code !== 2).map((e) => `${e.tau}:${PAID_EVENT_NAMES[e.code]}`)
}

function tauOf(r: PaidSolveResult, code: number, from = 0n): bigint {
  return r.events.find((e) => e.horse === H && e.code === code && e.tau >= from)!.tau
}

test('stamina empties at ceil(10⁹/14000), exhaustion freezes b and costs 10, recovery takes ceil(10⁹/10000)', () => {
  const r = cpuRace({ base: 200n, acceleration: 2n, cap: 600n }, [19, 20, 5])
  const enter = ceilDiv(STAMINA_CAPACITY, DRAIN)
  expect(enter).toBe(71_429n)
  expect(tauOf(r, EV_EXHAUST_ENTER)).toBe(enter)
  expect(tauOf(r, EV_EXHAUST_EXIT)).toBe(enter + ceilDiv(STAMINA_CAPACITY, REGEN))
  expect(tauOf(r, EV_EXHAUST_ENTER, enter + 1n)).toBe(enter + 100_000n + enter)
  const t = r.trace!
  const during = sampleHorse(t, H, enter + 50_000n)
  expect(during).toMatchObject({ exhausted: true, b: 200_000n + 2n * enter, stamina: REGEN * 50_000n })
  expect(during.v).toBe(200_000n + 2n * enter - 10_000n)
  const frame = t.keyframes[H]!.find((f) => f.tau0 === enter)!
  expect(frame.motion).toMatchObject({ exhausted: true, aEff: 0n })
  expect(exhaustedSpeed(frame.motion)).toBe(during.v)
  const exit = sampleHorse(t, H, enter + 100_000n)
  expect(exit).toMatchObject({ exhausted: false, stamina: STAMINA_CAPACITY })
})

test('rocket halves the running cost: net −2 per second while worn', () => {
  const r = cpuRace({ base: 300n, acceleration: 3n, cap: 500n }, [7, 20, 5])
  const pick = tauOf(r, EV_CARD)
  const s0 = STAMINA_CAPACITY - DRAIN * pick
  expect(sampleHorse(r.trace!, H, pick + 40_000n).stamina).toBe(s0 - 2_000n * 40_000n)
  expect(tauOf(r, EV_EXHAUST_ENTER)).toBe(pick + 40_000n + ceilDiv(s0 - 80_000_000n, DRAIN))
})

test('C-14 doubles regeneration for 5 s (net −4 per second while running)', () => {
  const r = cpuRace({ base: 300n, acceleration: 3n, cap: 500n }, [14, 20, 5])
  const pick = tauOf(r, EV_CARD)
  const s0 = STAMINA_CAPACITY - DRAIN * pick
  const s1 = s0 - 4_000n * 5_000n
  expect(tauOf(r, EV_EXPIRE)).toBe(pick + 5_000n)
  expect(sampleHorse(r.trace!, H, pick + 5_000n).stamina).toBe(s1)
  expect(tauOf(r, EV_EXHAUST_ENTER)).toBe(pick + 5_000n + ceilDiv(s1, DRAIN))
})

test('C-15 overcap drains at cost only until the first ms at or below capacity', () => {
  const r = cpuRace({ base: 5_000n, acceleration: 0n, cap: 5_000n }, [15, 20, 5])
  expect(log(r)[0]).toBe('0:BASE_CAP')
  const pick = tauOf(r, EV_CARD)
  const s = STAMINA_CAPACITY - DRAIN * pick + 200_000_000n
  expect(sampleHorse(r.trace!, H, pick).stamina).toBe(s)
  const end = pick + ceilDiv(s - STAMINA_CAPACITY, 24_000n)
  expect(tauOf(r, EV_OVERCAP_END)).toBe(end)
  expect(sampleHorse(r.trace!, H, end).stamina).toBe(s - 24_000n * (end - pick))
  expect(sampleHorse(r.trace!, H, end + 1_000n).stamina).toBe(s - 24_000n * (end - pick) - DRAIN * 1_000n)
})

test('C-15 while exhausted: exits immediately when it reaches capacity, otherwise only shortens recovery', () => {
  const full = cpuRace({ base: 100n, acceleration: 1n, cap: 200n }, [15, 20, 5])
  const pick = tauOf(full, EV_CARD)
  const s = REGEN * (pick - 71_429n) + 200_000_000n
  expect(s).toBeGreaterThan(STAMINA_CAPACITY)
  expect(log(full).slice(1, 4)).toEqual([
    `${pick}:CARD`, `${pick}:EXHAUST_EXIT`, `${pick + ceilDiv(s - STAMINA_CAPACITY, 24_000n)}:OVERCAP_END`,
  ])
  const partial = cpuRace({ base: 200n, acceleration: 2n, cap: 600n }, [15, 20, 5])
  const p = tauOf(partial, EV_CARD)
  const s2 = REGEN * (p - 71_429n) + 200_000_000n
  expect(s2).toBeLessThan(STAMINA_CAPACITY)
  expect(tauOf(partial, EV_EXHAUST_EXIT)).toBe(p + ceilDiv(STAMINA_CAPACITY - s2, REGEN))
})

test('C-16 keeps acceleration at zero stamina and exhausts at expiry when s = 0 and net < 0', () => {
  const r = cpuRace({ base: 330n, acceleration: 1n, cap: 500n }, [16, 20, 5])
  const pick = tauOf(r, EV_CARD)
  const zero = pick + ceilDiv(STAMINA_CAPACITY - DRAIN * pick, DRAIN)
  expect(zero).toBeLessThan(pick + 10_000n)
  const mid = sampleHorse(r.trace!, H, pick + 9_000n)
  expect(mid).toMatchObject({ stamina: 0n, exhausted: false })
  expect(mid.b).toBe(330_000n + pick + 9_000n)
  expect(sampleStatus(r.trace!, H, pick + 9_000n).wired).toBe(true)
  expect(log(r).filter((l) => l.startsWith(`${pick + 10_000n}:`))).toEqual([`${pick + 10_000n}:EXPIRE`, `${pick + 10_000n}:EXHAUST_ENTER`])
})

test('C-16 acquired while exhausted removes exhaustion and keeps the current stamina', () => {
  const r = cpuRace({ base: 250n, acceleration: 2n, cap: 400n }, [16, 20, 5])
  const pick = tauOf(r, EV_CARD)
  const exit = r.events.find((e) => e.horse === H && e.code === EV_EXHAUST_EXIT)!
  expect(exit.tau).toBe(pick)
  expect(exit.arg).toBe(REGEN * (pick - 71_429n))
  expect(tauOf(r, EV_BASE_CAP)).toBeGreaterThan(pick)
  expect(tauOf(r, EV_EXHAUST_ENTER, pick)).toBe(pick + 10_000n)
})

test('wired expiry with positive stamina leaves the normal drain in charge', () => {
  const r = cpuRace({ base: 5_000n, acceleration: 0n, cap: 5_000n }, [16, 20, 5])
  const pick = tauOf(r, EV_CARD)
  expect(r.events.some((e) => e.horse === H && e.code === EV_EXHAUST_ENTER)).toBe(false)
  expect(sampleHorse(r.trace!, H, pick + 10_000n).stamina).toBe(STAMINA_CAPACITY - DRAIN * (pick + 10_000n))
})
