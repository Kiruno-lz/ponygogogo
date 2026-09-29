import { expect, test } from 'bun:test'
import { STAMINA_CAPACITY, WELL_RADIUS_MICRO } from './constants.ts'
import {
  ceilDiv, exhaustedSpeed, firstReach, motionDelta, multiplierOf, speedAt, staminaAfter, staminaEventDt,
  wellFieldBps, type PaidMotion,
} from './motion.ts'

const running: PaidMotion = { exhausted: false, b: 1_200_000n, aEff: 12n, mult: 13_000n, fixed: 10n }

test('running interval integrates the percentage-scaled base speed and adds K outside the multiplier', () => {
  const dt = 1_000n
  const expected = 13_000n * (2n * 1_200_000n * dt + 12n * dt * dt) / 20_000n + 10n * 1_000n * dt
  expect(motionDelta(running, dt)).toBe(expected)
  expect(motionDelta(running, 0n)).toBe(0n)
  expect(speedAt(running, 1_800_000n, 0n)).toBe(1_200_000n * 13_000n / 10_000n + 10_000n)
  expect(speedAt(running, 1_210_000n, 5_000n)).toBe(1_210_000n * 13_000n / 10_000n + 10_000n)
})

test('b=20, +30%, +40%, +10 gives v = 44 units/s (card-design §3.2 vector)', () => {
  const m: PaidMotion = { exhausted: false, b: 20_000n, aEff: 0n, mult: multiplierOf(7_000n), fixed: 10n }
  expect(speedAt(m, 20_000n, 0n)).toBe(44_000n)
})

test('percentage multiplier never goes negative', () => {
  expect(multiplierOf(-12_000n)).toBe(0n)
  expect(multiplierOf(-10_000n)).toBe(0n)
  expect(multiplierOf(-9_999n)).toBe(1n)
  expect(multiplierOf(2_000n)).toBe(12_000n)
})

test('exhausted motion is linear at max(0, floor(b·m/10000) + (K − 10)·1000)', () => {
  const tired: PaidMotion = { exhausted: true, b: 1_500_000n, aEff: 0n, mult: 10_000n, fixed: 0n }
  expect(exhaustedSpeed(tired)).toBe(1_490_000n)
  expect(motionDelta(tired, 7n)).toBe(1_490_000n * 7n)
  expect(exhaustedSpeed({ ...tired, b: 5_000n })).toBe(0n)
  expect(speedAt({ ...tired, fixed: 20n }, 0n, 3n)).toBe(1_510_000n)
})

test('first reach returns the minimal whole millisecond satisfying the crossing', () => {
  for (const need of [1n, 1_199_999n, 1_200_000n, 1_200_001n, 987_654_321n]) {
    const got = firstReach(running, need, 10_000n)
    expect(motionDelta(running, got)).toBeGreaterThanOrEqual(need)
    if (got > 1n) expect(motionDelta(running, got - 1n)).toBeLessThan(need)
  }
})

test('gravity field matches browser at overlap, by relative position and at radius', () => {
  // Overlap takes the browser mod.field trailing branch: the target is pulled forward at full strength.
  expect(wellFieldBps(10n, 10n)).toBe(6_000n)
  expect(wellFieldBps(0n, 1n)).toBe(-6_000n)
  expect(wellFieldBps(1n, 0n)).toBe(6_000n)
  expect(wellFieldBps(0n, WELL_RADIUS_MICRO)).toBe(0n)
  expect(wellFieldBps(WELL_RADIUS_MICRO, 0n)).toBe(0n)
  expect(wellFieldBps(0n, WELL_RADIUS_MICRO - 1n)).toBe(0n)
  expect(wellFieldBps(0n, WELL_RADIUS_MICRO - 1_000_000n)).toBe(-1n)
  expect(wellFieldBps(0n, WELL_RADIUS_MICRO / 2n)).toBe(-3_000n)
  expect(wellFieldBps(WELL_RADIUS_MICRO / 4n, 0n)).toBe(4_500n)
  // Frozen values of the browser-equivalent field (the former paidGravity oracle): target ahead, then behind.
  const ahead = [6_000n, -6_000n, -6_000n, -3_000n, 0n, 0n]
  const behind = [6_000n, 6_000n, 6_000n, 3_000n, 0n, 0n]
  const distances = [0n, 1n, 777_777n, 4_000_000_000n, 7_999_999_999n, 8_000_000_000n]
  distances.forEach((d, i) => {
    expect(wellFieldBps(0n, d)).toBe(ahead[i]!)
    expect(wellFieldBps(d, 0n)).toBe(behind[i]!)
  })
})

test('stamina: normal drain clamps, overcap drains by cost only, exhausted regenerates to capacity', () => {
  const base = { s: 500_000_000n, exhausted: false, overcap: false, wired: false, cost: 24_000n, regen: 10_000n }
  expect(staminaAfter(base, 1_000n)).toBe(486_000_000n)
  expect(staminaEventDt(base)).toBe(ceilDiv(500_000_000n, 14_000n))
  expect(staminaAfter(base, 1_000_000n)).toBe(0n)
  expect(staminaEventDt({ ...base, wired: true })).toBeNull()
  expect(staminaEventDt({ ...base, regen: 30_000n })).toBeNull()
  expect(staminaAfter({ ...base, regen: 30_000n }, 1_000_000n)).toBe(STAMINA_CAPACITY)
  const over = { ...base, s: STAMINA_CAPACITY + 200_000_000n, overcap: true }
  expect(staminaEventDt(over)).toBe(8_334n)
  expect(staminaAfter(over, 8_334n)).toBe(STAMINA_CAPACITY + 200_000_000n - 24_000n * 8_334n)
  expect(staminaEventDt({ ...over, s: STAMINA_CAPACITY })).toBe(0n)
  const tired = { ...base, s: 0n, exhausted: true }
  expect(staminaEventDt(tired)).toBe(100_000n)
  expect(staminaAfter(tired, 99_999n)).toBe(999_990_000n)
  expect(staminaAfter(tired, 200_000n)).toBe(STAMINA_CAPACITY)
  expect(staminaEventDt({ ...tired, s: STAMINA_CAPACITY })).toBe(0n)
  expect(staminaEventDt({ ...base, s: 0n })).toBe(0n)
})

test('ceilDiv rejects negative numerators and non-positive denominators', () => {
  expect(ceilDiv(0n, 3n)).toBe(0n)
  expect(ceilDiv(7n, 3n)).toBe(3n)
  expect(() => ceilDiv(-1n, 3n)).toThrow('INVALID_CEIL_DIV')
  expect(() => ceilDiv(1n, 0n)).toThrow('INVALID_CEIL_DIV')
})
