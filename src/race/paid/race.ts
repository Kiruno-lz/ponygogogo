import type { Hex } from 'viem'
import { normalizeRoster } from '../core/roster.ts'
import { derivePaidCpuDeck } from '../core/paidCpuDeck.ts'
import { derivePaidDeck, FULL_CARD_MASK } from '../core/paidDeck.ts'
import { derivePaidProfiles, type PaidTier } from '../core/paidProfiles.ts'
import { HORSE_COUNT } from './constants.ts'
import {
  solvePaidCore, type PaidChoiceSlots, type PaidCoreInput, type PaidSolveOptions, type PaidSolveResult,
} from './solver.ts'

export type PaidRaceInput = {
  seed: Hex
  openAnchor: Hex
  stakeTier: PaidTier
  playerHorseId: number
  roster?: readonly number[]
  choices: PaidChoiceSlots
  /** Player card-pool eligibility (default: the full canonical pool). */
  cardMask?: bigint
}

/** Opening-anchor derivations: personalities, the player's 14-card deck and the CPU 3-card decks. */
export function derivePaidCoreInput(input: PaidRaceInput): PaidCoreInput {
  const { seed, openAnchor, stakeTier, playerHorseId } = input
  const roster = input.roster === undefined ? undefined : normalizeRoster(input.roster)
  const profiles = derivePaidProfiles(seed, openAnchor, stakeTier, playerHorseId).map((p) => ({
    base: BigInt(p.base), acceleration: BigInt(p.acceleration), cap: BigInt(p.cap),
  }))
  const cpuDecks: number[][] = []
  for (let h = 0; h < HORSE_COUNT; h++) {
    cpuDecks.push(h === playerHorseId ? [0, 0, 0] : derivePaidCpuDeck(seed, openAnchor, h))
  }
  return {
    profiles,
    ...(roster ? { roster } : {}),
    playerHorseId,
    playerDeck: derivePaidDeck(seed, openAnchor, input.cardMask ?? FULL_CARD_MASK),
    cpuDecks,
    seed,
    openAnchor,
    choices: input.choices,
  }
}

export function solvePaidRace(input: PaidRaceInput, opts?: PaidSolveOptions): PaidSolveResult {
  return solvePaidCore(derivePaidCoreInput(input), opts)
}
