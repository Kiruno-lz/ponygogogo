import { expect, test } from 'bun:test'
import { keccak256, toBytes, type Hex } from 'viem'
import { chainEntropy } from './chainEntropy.ts'
import { derivePaidProfiles, LEGACY_PLAYER_PAID_PROFILE, PLAYER_PAID_PROFILE, type PaidTier } from './paidProfiles.ts'
import { PLAYER_BALANCE } from '../paid/playerBalance.ts'

const SEED = `0x${'11'.repeat(32)}` as const
const ANCHOR = `0x${'22'.repeat(32)}` as const
const CAP_DOMAIN = keccak256(toBytes('horse.cap'))
const TIERS: PaidTier[] = [1, 2, 3, 4]
const anchorOf = (n: number): Hex => keccak256(toBytes(`paid-profiles/anchor/${n}`))
const cpus = (playerId: number, anchor: Hex = ANCHOR, tier: PaidTier = 2) =>
  derivePaidProfiles(SEED, anchor, tier, playerId).filter((_, i) => i !== playerId)

test('CPU horses use the player baseline with a cap offset from the opening anchor', () => {
  expect(derivePaidProfiles(SEED, ANCHOR, 2, 1)).toEqual([
    { base: 300, acceleration: 150, cap: 2186 },
    PLAYER_PAID_PROFILE,
    { base: 300, acceleration: 150, cap: 2200 },
    { base: 300, acceleration: 150, cap: 2149 },
    { base: 300, acceleration: 150, cap: 2221 },
  ])
})

test('CPU cap offset is min + chainEntropy(seed, anchor, 0, horse.cap, group) mod the inclusive span', () => {
  const { speedCap, cpuCapOffsetMin: lo, cpuCapOffsetMax: hi } = PLAYER_BALANCE
  expect([lo, hi]).toEqual([100, 500])
  for (let n = 0; n < 8; n++) {
    cpus(n % 5, anchorOf(n)).forEach((p, group) => {
      const offset = lo + Number(chainEntropy(SEED, anchorOf(n), 0, CAP_DOMAIN, BigInt(group)) % BigInt(hi - lo + 1))
      expect(p).toEqual({ base: PLAYER_BALANCE.startSpeed, acceleration: PLAYER_BALANCE.acceleration, cap: speedCap + offset })
    })
  }
})

test('stake tier no longer changes CPU strength', () => {
  for (const tier of TIERS) expect(derivePaidProfiles(SEED, ANCHOR, tier, 3)).toEqual(derivePaidProfiles(SEED, ANCHOR, 2, 3))
})

test('CPU caps stay within [speedCap + min, speedCap + max] and vary with the opening anchor', () => {
  const caps = Array.from({ length: 64 }, (_, n) => cpus(n % 5, anchorOf(n)).map((p) => p.cap)).flat()
  expect(Math.min(...caps)).toBeGreaterThanOrEqual(1900)
  expect(Math.max(...caps)).toBeLessThanOrEqual(2300)
  expect(new Set(caps).size).toBeGreaterThan(100)
  expect(Math.min(...caps)).toBeLessThan(1950)
  expect(Math.max(...caps)).toBeGreaterThan(2250)
  expect(cpus(0, anchorOf(1))).toEqual(cpus(0, anchorOf(1)))
  expect(cpus(0, anchorOf(1))).not.toEqual(cpus(0, anchorOf(2)))
})

test('legacy tier personalities keep their frozen cross-language vectors', () => {
  expect(derivePaidProfiles(SEED, ANCHOR, 2, 1, true)).toEqual([
    { base: 1212, acceleration: 14, cap: 1913 },
    LEGACY_PLAYER_PAID_PROFILE,
    { base: 1245, acceleration: 12, cap: 1853 },
    { base: 1237, acceleration: 11, cap: 1802 },
    { base: 1254, acceleration: 14, cap: 1786 },
  ])
  expect(derivePaidProfiles(SEED, ANCHOR, 4, 1, true)).toEqual([
    { base: 1332, acceleration: 16, cap: 2073 },
    LEGACY_PLAYER_PAID_PROFILE,
    { base: 1365, acceleration: 14, cap: 2013 },
    { base: 1357, acceleration: 13, cap: 1962 },
    { base: 1374, acceleration: 16, cap: 1946 },
  ])
})

test('selecting another horse does not change the four opponent personalities', () => {
  expect(cpus(0)).toEqual(cpus(4))
  expect(cpus(1)).toEqual(cpus(3))
  const legacy = (playerId: number) => derivePaidProfiles(SEED, ANCHOR, 2, playerId, true).filter((_, i) => i !== playerId)
  expect(legacy(0)).toEqual(legacy(4))
  expect(legacy(1)).toEqual(legacy(3))
})

test('paid profile input rejects free-demo tier and invalid horse', () => {
  for (const legacy of [false, true]) {
    expect(() => derivePaidProfiles(SEED, ANCHOR, 0 as 1, 1, legacy)).toThrow('INVALID_TIER')
    expect(() => derivePaidProfiles(SEED, ANCHOR, 5 as 1, 1, legacy)).toThrow('INVALID_TIER')
    expect(() => derivePaidProfiles(SEED, ANCHOR, 1, 5, legacy)).toThrow('INVALID_HORSE')
  }
})
