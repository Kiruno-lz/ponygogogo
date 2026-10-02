import {
  BPS, EXHAUST_PENALTY, STAMINA_CAPACITY, WELL_OVERLAP_BPS, WELL_RADIUS_MICRO, WELL_STRENGTH_BPS,
} from './constants.ts'

/** Parameters frozen over one motion interval; b in mu/s, aEff in mu/s per ms, fixed K in units/s. */
export type PaidMotion = {
  exhausted: boolean
  b: bigint
  aEff: bigint
  mult: bigint
  fixed: bigint
}

/** Stamina parameters frozen over one interval; cost/regen in µstamina per ms. */
export type PaidStaminaMotion = {
  s: bigint
  exhausted: boolean
  overcap: boolean
  wired: boolean
  cost: bigint
  regen: bigint
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('INVALID_CEIL_DIV')
  return (numerator + denominator - 1n) / denominator
}

/** Percentage multiplier with the frozen lower bound 0: max(0, 10000 + P). */
export function multiplierOf(pBps: bigint): bigint {
  const m = BPS + pBps
  return m > 0n ? m : 0n
}

/** Constant exhausted speed: max(0, floor(b·m/10000) + (K − E)·1000). */
export function exhaustedSpeed(m: PaidMotion): bigint {
  const v = m.b * m.mult / BPS + (m.fixed - EXHAUST_PENALTY) * 1000n
  return v > 0n ? v : 0n
}

/** Δpos over dt whole milliseconds; non-decreasing in dt because m, b, aEff, K ≥ 0. */
export function motionDelta(m: PaidMotion, dt: bigint): bigint {
  if (m.exhausted) return exhaustedSpeed(m) * dt
  let b = m.b
  const initial = b * m.mult + m.fixed * 1000n * BPS
  if (initial < 0n) {
    const slope = m.aEff * m.mult
    if (slope === 0n) return 0n
    const zero = ceilDiv(-initial, slope)
    if (dt <= zero) return 0n
    dt -= zero
    b += m.aEff * zero
  }
  const delta = m.mult * (2n * b * dt + m.aEff * dt * dt) / (2n * BPS) + m.fixed * 1000n * dt
  return delta > 0n ? delta : 0n
}

/** Effective speed (mu/s) dt ms into the interval; rendering only, b is capped by capMilli. */
export function speedAt(m: PaidMotion, capMilli: bigint, dt: bigint): bigint {
  if (m.exhausted) return exhaustedSpeed(m)
  const grown = m.b + m.aEff * dt
  const b = grown > capMilli ? capMilli : grown
  const v = b * m.mult / BPS + m.fixed * 1000n
  return v > 0n ? v : 0n
}

/** Smallest dt in [1, maxDt] with motionDelta(dt) ≥ need; caller guarantees motionDelta(maxDt) ≥ need > 0. */
export function firstReach(m: PaidMotion, need: bigint, maxDt: bigint): bigint {
  let lo = 1n
  let hi = maxDt
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    if (motionDelta(m, mid) >= need) hi = mid
    else lo = mid + 1n
  }
  return lo
}

/** C-10 field on a target: overlap uses the browser's trailing branch; ahead slows, behind speeds up. */
export function wellFieldBps(ownerPos: bigint, targetPos: bigint): bigint {
  const delta = targetPos - ownerPos
  const d = delta < 0n ? -delta : delta
  if (d >= WELL_RADIUS_MICRO) return 0n
  if (delta === 0n) return WELL_OVERLAP_BPS
  const factor = BPS - d * BPS / WELL_RADIUS_MICRO
  const k = WELL_STRENGTH_BPS * factor / BPS
  return delta > 0n ? -k : k
}

export function staminaAfter(x: PaidStaminaMotion, dt: bigint): bigint {
  if (x.exhausted) {
    const next = x.s + x.regen * dt
    return next > STAMINA_CAPACITY ? STAMINA_CAPACITY : next
  }
  if (x.overcap) return x.s - x.cost * dt
  const next = x.s + (x.regen - x.cost) * dt
  return next < 0n ? 0n : next > STAMINA_CAPACITY ? STAMINA_CAPACITY : next
}

/** ms until the next stamina threshold (0 = due now), or null when none is scheduled. */
export function staminaEventDt(x: PaidStaminaMotion): bigint | null {
  if (x.exhausted) return x.s >= STAMINA_CAPACITY ? 0n : ceilDiv(STAMINA_CAPACITY - x.s, x.regen)
  if (x.overcap) return x.s <= STAMINA_CAPACITY ? 0n : ceilDiv(x.s - STAMINA_CAPACITY, x.cost)
  const net = x.regen - x.cost
  if (net >= 0n || x.wired) return null
  return ceilDiv(x.s, -net)
}
