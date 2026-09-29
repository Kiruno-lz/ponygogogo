import { MON } from './amount.ts'

/**
 * Tier 0 is local free play; paid transactions accept tiers 1–4 only (0.3 / 1 / 5 / 10 MON, exact wei, PonyGame
 * stakeForTier). Tier i uses personality range i.
 */
export const PAID_STAKE_WEI = [0n, MON * 3n / 10n, MON, MON * 5n, MON * 10n] as const
export const PAID_STAKE_LABELS = ['0', '0.3', '1', '5', '10'] as const

/** 第一名总返还 3 倍（PonyGame.payoutMultipliers()[0] = 30000 bps，含本金）：选档页的「最多赢」按它算 */
export const PAID_TOP_PAYOUT_BPS = 30_000n

export function paidMaxPayout(tier: 1 | 2 | 3 | 4): bigint {
  return (PAID_STAKE_WEI[tier] * PAID_TOP_PAYOUT_BPS) / 10_000n
}

export function paidTierForStake(stake: bigint): 1 | 2 | 3 | 4 {
  const tier = PAID_STAKE_WEI.findIndex((value) => value === stake)
  if (tier < 1 || tier > 4) throw new Error('INVALID_PAID_ENTRY')
  return tier as 1 | 2 | 3 | 4
}
