import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'
import { PAID_CARD_RULES } from './cardRules.ts'
import { PONY_RULES } from './ponyRules.ts'
import { DEFAULT_ROSTER } from '../core/roster.ts'

export const REWARD_RULES = { grantChanceBps: 2000, rareCardWeight: 1, ponyWeight: 3, recordGas: 120000, gasReserve: 200000 } as const
export type RewardAsset = { assetKind: 0 | 1; assetId: number; bit: number; weight: number }
export const REWARD_ASSETS: readonly RewardAsset[] = [
  ...PAID_CARD_RULES.filter(c => c.rare).map(c => ({ assetKind: 0 as const, assetId: c.id, bit: c.id, weight: REWARD_RULES.rareCardWeight })),
  ...PONY_RULES.filter(p => p.enabled && !DEFAULT_ROSTER.includes(p.id)).map(p => ({ assetKind: 1 as const, assetId: p.id, bit: 64 + p.id, weight: REWARD_RULES.ponyWeight })),
]

export function rewardSeed(parentHash: Hex, chainId: bigint, game: Address, sessionId: Hex, player: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }],
    [parentHash, chainId, game, sessionId, player]))
}

export function rewardAtRoll(roll: bigint, pick: bigint, ownedMask: bigint): RewardAsset | null {
  if (roll >= BigInt(REWARD_RULES.grantChanceBps)) return null
  const candidates = REWARD_ASSETS.filter(a => (ownedMask & (1n << BigInt(a.bit))) === 0n)
  const total = candidates.reduce((sum, a) => sum + BigInt(a.weight), 0n)
  if (total === 0n) return null
  let cursor = pick % total
  for (const asset of candidates) {
    if (cursor < BigInt(asset.weight)) return asset
    cursor -= BigInt(asset.weight)
  }
  throw new Error('INVALID_REWARD_TABLE')
}

export function selectReward(seed: Hex, ownedMask: bigint): RewardAsset | null {
  const hash = (index: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [seed, index])))
  return rewardAtRoll(hash(0n) % 10000n, hash(1n), ownedMask)
}
