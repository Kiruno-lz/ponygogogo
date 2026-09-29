import { keccak256, toBytes } from 'viem'
import { PAID_CARD_GLOBALS, PAID_RULESET_HASH, paidCardRule } from './cardRules.ts'

/** Paid ruleset v3. Units: τ/wall ms, pos/dist µu, b mu/s. */
export { PAID_RULESET_HASH }

export const HORSE_COUNT = 5
export const TRACK_MICRO = 100_000_000_000n
export const CHECKPOINT_MICRO = [25_000_000_000n, 50_000_000_000n, 75_000_000_000n] as const
export const MAX_TAU = 600_000n
/** finishTime of a horse still running at MAX_TAU. */
export const UNFINISHED_TAU = 600_001n
/** Sentinel for "no time": permanent instances, finishWall of an unfinished horse. Fits uint32. */
export const NEVER = 0xffff_ffffn

export const BPS = 10_000n
export const STAMINA_CAPACITY = 1_000_000_000n
export const COST_PER_MS = 24_000n
export const ROCKET_COST_PER_MS = COST_PER_MS * BigInt(paidCardRule(7).costMultiplierBps!) / BPS
export const REGEN_PER_MS = 10_000n
export const ADRENALINE_MICRO = BigInt(paidCardRule(15).staminaMicro!)
export const EXHAUST_PENALTY = 10n

export const WELL_RADIUS_MICRO = BigInt(paidCardRule(10).radiusMicro!)
export const WELL_STRENGTH_BPS = BigInt(paidCardRule(10).strengthBps!)
export const WELL_OVERLAP_BPS = BigInt(paidCardRule(10).overlapBps!)
export const WIND_BPS = BigInt(paidCardRule(12).strengthBps!)
export const WHEEL_DELTA_V = BigInt(paidCardRule(11).fixedSpeed!)
export const RK_STEP_MS = 50n

export const SLOW_FACTOR = 10n
export const CHOICE_WINDOW_SEC = 20n
export const AUTO_PANEL_SEC = BigInt(paidCardRule(4).autoPanelSec!)
export const RESPAWN_MS = 5_000n
export const SWAP_PERIOD_MS = BigInt(paidCardRule(9).periodMs!)
export const SWAP_ATTEMPTS = paidCardRule(9).count!
export const WHEEL_PERIOD_MS = BigInt(paidCardRule(11).periodMs!)
export const WHEEL_BURSTS = paidCardRule(11).count!
/** CPU C-09 swap eventIndex = cardEventIndex · 256 + attempt (player cardEventIndex = 0). */
export const SWAP_EVENT_STRIDE = 256n
export const BONUS_BPS = BigInt(paidCardRule(4).bonusBps!)
export const BONUS_DEFAULT_MS = BigInt(PAID_CARD_GLOBALS.bonusDefaultMs)

export const MAX_INSTANCES = 64
export const MAX_BOMBS = 20
export const MAX_EVENTS = 4096

export const PURPOSE_WIND = keccak256(toBytes('wind'))
export const PURPOSE_STEAL = keccak256(toBytes('steal'))

export const SLOT_TORSO = 0
export const SLOT_TAIL = 1
export const SLOT_HOOVES = 2

/** Finite main-effect durations; every other card is instant or permanent. */
export function cardDurationMs(cardId: number): bigint | null {
  const duration = paidCardRule(cardId).durationMs
  return duration === null || duration === 0 ? null : BigInt(duration)
}

/** C-04 bonus length (null = permanent); lootMs is the stolen equipment's full duration (0 = nothing stolen). */
export function bonusDurationMs(cardId: number, lootMs: bigint): bigint | null {
  const rule = paidCardRule(cardId)
  if (rule.bonusMode === 'follow') return BigInt(rule.durationMs!)
  if (rule.bonusMode === 'permanent') return null
  if (rule.bonusMode === 'loot' && lootMs > 0n) return lootMs
  return BONUS_DEFAULT_MS
}
