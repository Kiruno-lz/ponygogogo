import { keccak256, toBytes, type Hex } from 'viem'
import { chainEntropy } from './chainEntropy.ts'
import { PLAYER_BALANCE } from '../paid/playerBalance.ts'

export type PaidProfile = { base: number; acceleration: number; cap: number }
export type PaidTier = 1 | 2 | 3 | 4

export const PAID_TRACK_LENGTH = 100_000n
export const PAID_MAX_MS = 600_000n
export const PLAYER_PAID_PROFILE: PaidProfile = { base: PLAYER_BALANCE.startSpeed, acceleration: PLAYER_BALANCE.acceleration, cap: PLAYER_BALANCE.speedCap }

const CAP_DOMAIN = keccak256(toBytes('horse.cap'))


function sample(seed: Hex, anchor: Hex, domain: Hex, group: number, range: readonly [number, number]): number {
  const [lo, hi] = range
  return lo + Number(chainEntropy(seed, anchor, 0, domain, BigInt(group)) % BigInt(hi - lo + 1))
}

/**
 * Four opponent personalities are independent of the chosen visual horse ID. Roster rules give every CPU the player
 * baseline plus a cap offset; stake tiers share this profile model.
 */
export function derivePaidProfiles(seed: Hex, anchor: Hex, stakeTier: PaidTier, playerHorseId: number): PaidProfile[] {
  if (playerHorseId < 0 || playerHorseId > 4 || !Number.isInteger(playerHorseId)) throw new Error('INVALID_HORSE')
  if (stakeTier < 1 || stakeTier > 4 || !Number.isInteger(stakeTier)) throw new Error('INVALID_TIER')
  // Read at call time so calibration can override the offset range in-process.
  const capRange = [PLAYER_BALANCE.speedCap + PLAYER_BALANCE.cpuCapOffsetMin, PLAYER_BALANCE.speedCap + PLAYER_BALANCE.cpuCapOffsetMax] as const
  const profiles: PaidProfile[] = []
  let group = 0
  for (let horseId = 0; horseId < 5; horseId++) {
    if (horseId === playerHorseId) {
      profiles.push(PLAYER_PAID_PROFILE)
      continue
    }
    profiles.push({ ...PLAYER_PAID_PROFILE, cap: sample(seed, anchor, CAP_DOMAIN, group, capRange) })
    group++
  }
  return profiles
}
