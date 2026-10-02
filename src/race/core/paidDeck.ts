import type { Hex } from 'viem'
import { chainEntropy, PURPOSE_CARD } from './chainEntropy.ts'
import { PAID_RARE_MASK, PAID_CARD_COUNT } from '../paid/cardRules.ts'

export const FULL_CARD_MASK = (1n << BigInt(PAID_CARD_COUNT)) - 1n
export const RARE_CARD_MASK = PAID_RARE_MASK

function idsIn(mask: bigint): number[] {
  const out: number[] = []
  for (let id = 1; id <= PAID_CARD_COUNT; id++) if ((mask & (1n << BigInt(id - 1))) !== 0n) out.push(id)
  return out
}

/** Fourteen cards without replacement; rare tail is drawn before the first twelve. */
export function derivePaidDeck(seed: Hex, anchor: Hex, eligibleMask: bigint = FULL_CARD_MASK): number[] {
  if (eligibleMask < 0n || (eligibleMask & ~FULL_CARD_MASK) !== 0n) throw new Error('INVALID_CARD_MASK')
  const all = idsIn(eligibleMask)
  const rare = idsIn(eligibleMask & RARE_CARD_MASK)
  if (all.length < 14 || rare.length < 2) throw new Error('CARD_POOL_TOO_SMALL')
  const pick = (remaining: number[], position: number) => {
    const idx = Number(chainEntropy(seed, anchor, 0, PURPOSE_CARD, BigInt(position)) % BigInt(remaining.length))
    return remaining.splice(idx, 1)[0]!
  }
  const deck = Array<number>(14)
  deck[12] = pick(rare, 0)
  deck[13] = pick(rare, 1)
  const rest = all.filter((id) => id !== deck[12] && id !== deck[13])
  for (let i = 0; i < 12; i++) deck[i] = pick(rest, i + 2)
  return deck
}
