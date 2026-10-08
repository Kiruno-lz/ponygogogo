import { keccak256, toBytes, type Hex } from 'viem'
import { chainEntropy } from './chainEntropy.ts'
import { PLAYER_BALANCE } from '../paid/playerBalance.ts'

export type PaidProfile = { base: number; acceleration: number; cap: number }
export type PaidTier = 1 | 2 | 3 | 4

export const PAID_TRACK_LENGTH = 100_000n
export const PAID_MAX_MS = 600_000n
export const PLAYER_PAID_PROFILE: PaidProfile = { base: PLAYER_BALANCE.startSpeed, acceleration: PLAYER_BALANCE.acceleration, cap: PLAYER_BALANCE.speedCap }
export const LEGACY_PLAYER_PAID_PROFILE: PaidProfile = { base: 1200, acceleration: 12, cap: 1800 }

const BASE_DOMAIN = keccak256(toBytes('horse.base'))
const ACCEL_DOMAIN = keccak256(toBytes('horse.acceleration'))
const CAP_DOMAIN = keccak256(toBytes('horse.cap'))

/** Records without a roster: the stake tier picked the CPU personality ranges. */
const LEGACY_TIERS = [
  { base: [1120, 1240], acceleration: [10, 13], cap: [1700, 1840] },
  { base: [1180, 1300], acceleration: [11, 14], cap: [1780, 1920] },
  { base: [1240, 1360], acceleration: [12, 15], cap: [1860, 2000] },
  { base: [1300, 1420], acceleration: [13, 16], cap: [1940, 2080] },
] as const

function sample(seed: Hex, anchor: Hex, domain: Hex, group: number, range: readonly [number, number]): number {
  const [lo, hi] = range
  return lo + Number(chainEntropy(seed, anchor, 0, domain, BigInt(group)) % BigInt(hi - lo + 1))
}

/**
 * Four opponent personalities are independent of the chosen visual horse ID. Roster rules give every CPU the player
 * baseline plus a cap offset; the stake tier is validated but only shapes legacy personalities.
 */
export function derivePaidProfiles(seed: Hex, anchor: Hex, stakeTier: PaidTier, playerHorseId: number, legacy = false): PaidProfile[] {
  if (playerHorseId < 0 || playerHorseId > 4 || !Number.isInteger(playerHorseId)) throw new Error('INVALID_HORSE')
  if (stakeTier < 1 || stakeTier > 4 || !Number.isInteger(stakeTier)) throw new Error('INVALID_TIER')
  const tier = LEGACY_TIERS[stakeTier - 1]
  // Read at call time so calibration can override the offset range in-process.
  const capRange = [PLAYER_BALANCE.speedCap + PLAYER_BALANCE.cpuCapOffsetMin, PLAYER_BALANCE.speedCap + PLAYER_BALANCE.cpuCapOffsetMax] as const
  const profiles: PaidProfile[] = []
  let group = 0
  for (let horseId = 0; horseId < 5; horseId++) {
    if (horseId === playerHorseId) {
      profiles.push(legacy ? LEGACY_PLAYER_PAID_PROFILE : PLAYER_PAID_PROFILE)
      continue
    }
    profiles.push(legacy ? {
      base: sample(seed, anchor, BASE_DOMAIN, group, tier.base),
      acceleration: sample(seed, anchor, ACCEL_DOMAIN, group, tier.acceleration),
      cap: sample(seed, anchor, CAP_DOMAIN, group, tier.cap),
    } : { ...PLAYER_PAID_PROFILE, cap: sample(seed, anchor, CAP_DOMAIN, group, capRange) })
    group++
  }
  return profiles
}
