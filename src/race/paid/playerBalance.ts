import { keccak256, toBytes } from 'viem'

/** Player base rules in distance units, stamina units and simulation seconds. */
export const PLAYER_BALANCE = {
  startSpeed: 300,
  acceleration: 150,
  speedCap: 1800,
  staminaCapacity: 300,
  exhaustRelease: 135,
  staminaCostPerSecond: 20,
  staminaRegenPerSecond: 10,
  exhaustRegenPerSecond: 15,
  exhaustSpeedCap: 1200,
  overcapCostDivisor: 2,
  /** Roster-rule CPUs run this baseline; each CPU's cap adds a uniform offset in [min, max] from the opening anchor. */
  cpuCapOffsetMin: 100,
  cpuCapOffsetMax: 500,
} as const

export const PLAYER_BALANCE_HASH = keccak256(toBytes(JSON.stringify(PLAYER_BALANCE)))
