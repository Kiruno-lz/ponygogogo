import { paidCardRule } from './cardRules.ts'
import { SLOT_HOOVES, SLOT_TAIL, SLOT_TORSO, SLOW_FACTOR } from './constants.ts'
import type { PaidLoggedEvent } from './events.ts'
import { motionDelta, speedAt, staminaAfter, type PaidMotion, type PaidStaminaMotion } from './motion.ts'

/** Horse state at tau0 plus the frozen parameters the solver used up to tau1 (closed form in between). */
export type PaidKeyframe = {
  tau0: bigint
  tau1: bigint
  pos: bigint
  dist: bigint
  lane: number
  finished: boolean
  capMilli: bigint
  pBps: bigint
  motion: PaidMotion
  stamina: PaidStaminaMotion
}

/** bonus = C-04 +2000 bps attached to a later card (cardId = that card). */
export type PaidInstanceKind = 'buff' | 'bonus' | 'equip' | 'ability' | 'respawn' | 'watch' | 'fixed'
export type PaidInstanceEnd = 'expired' | 'replaced' | 'stolen' | 'finished' | 'recycled' | 'consumed' | 'death'

export type PaidTraceInstance = {
  id: number
  horse: number
  cardId: number
  kind: PaidInstanceKind
  initialP: bigint
  slot: number
  startTau: bigint
  /** Scheduled expiry (null = permanent); endTau is when it actually ended. */
  plannedEndTau: bigint | null
  endTau: bigint | null
  endReason: PaidInstanceEnd | null
}

export type PaidTraceBomb = {
  id: number
  lane: number
  pos: bigint
  placer: number
  placedTau: bigint
  goneTau: bigint | null
  victim: number | null
}

export type PaidTraceWind = { tau: bigint; bps: bigint; placer: number }
export type PaidTraceCard = { tau: bigint; horse: number; cardId: number }
/** Piecewise wall(τ): slow segments run at 10 wall ms per sim ms. */
export type PaidTimeSegment = { tau: bigint; wall: bigint; slow: boolean }

export type PaidTrace = {
  tauEnd: bigint
  keyframes: PaidKeyframe[][]
  instances: PaidTraceInstance[]
  bombs: PaidTraceBomb[]
  winds: PaidTraceWind[]
  cards: PaidTraceCard[]
  segments: PaidTimeSegment[]
  events: PaidLoggedEvent[]
  renewals: { instanceId: number; tau: bigint; end: bigint }[]
}

export type PaidHorseSample = {
  pos: bigint
  dist: bigint
  b: bigint
  v: bigint
  stamina: bigint
  lane: number
  finished: boolean
  exhausted: boolean
  pBps: bigint
}

export type PaidStatusSample = {
  airborne: boolean
  exhausted: boolean
  wired: boolean
  respawning: boolean
  blindedPro: boolean
  /** cardId of the equipment worn per slot, 0 = empty. */
  equipment: { torso: number; tail: number; hooves: number }
}

function lastAtOrBefore<T>(items: readonly T[], key: (item: T) => bigint, value: bigint): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(items[mid]!) <= value) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Exact solver state of one horse at integer sim ms tau (post-event state at event instants). */
export function sampleHorse(trace: PaidTrace, horse: number, tau: bigint): PaidHorseSample {
  const frames = trace.keyframes[horse]
  if (!frames || frames.length === 0) throw new Error('NO_TRACE')
  const index = lastAtOrBefore(frames, (f) => f.tau0, tau)
  const frame = frames[index < 0 ? 0 : index]!
  const clamped = tau < frame.tau0 ? frame.tau0 : tau > frame.tau1 ? frame.tau1 : tau
  const dt = frame.finished ? 0n : clamped - frame.tau0
  const delta = motionDelta(frame.motion, dt)
  const grown = frame.motion.b + frame.motion.aEff * dt
  return {
    pos: frame.pos + delta,
    dist: frame.dist + delta,
    b: grown > frame.capMilli ? frame.capMilli : grown,
    v: frame.finished ? 0n : speedAt(frame.motion, frame.capMilli, dt),
    stamina: staminaAfter(frame.stamina, dt),
    lane: frame.lane,
    finished: frame.finished,
    exhausted: frame.motion.exhausted,
    pBps: frame.pBps,
  }
}

function activeAt(inst: PaidTraceInstance, tau: bigint): boolean {
  return inst.startTau <= tau && (inst.endTau === null || tau < inst.endTau)
}

export function sampleStatus(trace: PaidTrace, horse: number, tau: bigint): PaidStatusSample {
  const equipment = { torso: 0, tail: 0, hooves: 0 }
  let airborne = false
  let wired = false
  let respawning = false
  for (const inst of trace.instances) {
    if (inst.horse !== horse || !activeAt(inst, tau)) continue
    const effect = inst.cardId > 0 ? paidCardRule(inst.cardId).effect : null
    if ((inst.kind === 'buff' && effect === 'airborneSpeed') || (inst.kind === 'equip' && effect === 'wheel')) airborne = true
    if (inst.kind === 'buff' && effect === 'wired') wired = true
    if (inst.kind === 'respawn') respawning = true
    if (inst.kind === 'equip') {
      if (inst.slot === SLOT_TORSO) equipment.torso = inst.cardId
      if (inst.slot === SLOT_TAIL) equipment.tail = inst.cardId
      if (inst.slot === SLOT_HOOVES) equipment.hooves = inst.cardId
    }
  }
  const blindedPro = trace.cards.some((c) => c.horse === horse && paidCardRule(c.cardId).effect === 'blindFixed' && c.tau <= tau)
  return { airborne, exhausted: sampleHorse(trace, horse, tau).exhausted, wired, respawning, blindedPro, equipment }
}

export function bombsAt(trace: PaidTrace, tau: bigint): PaidTraceBomb[] {
  return trace.bombs.filter((b) => b.placedTau <= tau && (b.goneTau === null || tau < b.goneTau))
}

/** Current environment wind in bps (0 before any C-12). */
export function windAt(trace: PaidTrace, tau: bigint): PaidTraceWind | null {
  const index = lastAtOrBefore(trace.winds, (w) => w.tau, tau)
  return index < 0 ? null : trace.winds[index]!
}

/** wall(τ); at a panel-close instant this returns the post-close mapping (the event log keeps exact stamps). */
export function wallAtTau(trace: PaidTrace, tau: bigint): bigint {
  const index = lastAtOrBefore(trace.segments, (s) => s.tau, tau)
  const seg = trace.segments[index < 0 ? 0 : index]!
  return seg.wall + (tau - seg.tau) * (seg.slow ? SLOW_FACTOR : 1n)
}

/** Largest sim ms whose wall stamp is ≤ wall; a slow segment freezes at its closing τ until the close wall. */
export function tauAtWall(trace: PaidTrace, wall: bigint): bigint {
  const index = lastAtOrBefore(trace.segments, (s) => s.wall, wall)
  const seg = trace.segments[index < 0 ? 0 : index]!
  if (!seg.slow) return seg.tau + (wall - seg.wall)
  const tau = seg.tau + (wall - seg.wall) / SLOW_FACTOR
  const next = trace.segments[index + 1]
  return next !== undefined && tau > next.tau ? next.tau : tau
}
