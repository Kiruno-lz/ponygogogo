import { keccak256, toBytes, type Hex } from 'viem'
import { chainEntropy } from './chainEntropy.ts'
import { consumePaidChoice } from './paidChoice.ts'
import { paidCardRule } from '../paid/cardRules.ts'
import {
  INVALID_AUTO, INVALID_BAD_SLOT, INVALID_CUT, INVALID_EXHAUSTED, INVALID_NO_CREDIT, INVALID_NOT_OFFERED,
} from '../paid/events.ts'

const AUTOPICK_DOMAIN = keccak256(toBytes('autopick'))

export type PaidDrawState = {
  cursor: number
  tailCursor: number
  refreshCredits: number
  automatic: boolean
  forfeited: boolean
}

export function initialPaidDrawState(): PaidDrawState {
  return { cursor: 0, tailCursor: 14, refreshCredits: 0, automatic: false, forfeited: false }
}

function applyCard(state: PaidDrawState, cardId: number): PaidDrawState {
  if (cardId === 0) return state
  const rule = paidCardRule(cardId)
  return {
    ...state,
    refreshCredits: state.refreshCredits + (rule.effect === 'refresh' ? rule.count! : 0),
    automatic: state.automatic || rule.effect === 'drawAuto',
    forfeited: state.forfeited || rule.effect === 'drawCut',
  }
}

/** A player-signed choice; time and block authenticity remain Game checks. */
export function applyPaidChoice(
  deck: readonly number[], state: PaidDrawState, refreshSlots: readonly number[], chosenId: number,
): PaidDrawState {
  if (state.automatic || state.forfeited) throw new Error('CHOICE_DISABLED')
  if (refreshSlots.length > state.refreshCredits) throw new Error('NO_REFRESH_CREDIT')
  const { nextCursor, candidates } = consumePaidChoice(deck, state.cursor, [], 0)
  let tailCursor = state.tailCursor
  let refreshed = 0
  for (const slot of refreshSlots) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 2 || (refreshed & (1 << slot)) !== 0) {
      throw new Error('INVALID_REFRESH')
    }
    if (tailCursor <= nextCursor) throw new Error('DECK_EXHAUSTED')
    candidates[slot] = deck[--tailCursor]!
    refreshed |= 1 << slot
  }
  if (chosenId !== 0 && !candidates.includes(chosenId)) throw new Error('CARD_NOT_OFFERED')
  return applyCard({
    ...state,
    cursor: nextCursor,
    tailCursor,
    refreshCredits: state.refreshCredits - refreshSlots.length,
  }, chosenId)
}

/**
 * Non-throwing precheck of applyPaidChoice: 0 when it would succeed, else the INVALID_* code of the first rule it
 * breaks, in applyPaidChoice's own order (有奖规则 v3). Cut is judged before auto, like the panel opening.
 */
export function classifyPaidDraw(
  deck: readonly number[], state: PaidDrawState, refreshSlots: readonly number[], chosenId: number,
): number {
  if (state.forfeited) return INVALID_CUT
  if (state.automatic) return INVALID_AUTO
  if (refreshSlots.length > state.refreshCredits) return INVALID_NO_CREDIT
  if (state.cursor + 3 > deck.length) return INVALID_EXHAUSTED
  const nextCursor = state.cursor + 3
  const candidates = deck.slice(state.cursor, nextCursor)
  let tailCursor = state.tailCursor
  let refreshed = 0
  for (const slot of refreshSlots) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 2 || (refreshed & (1 << slot)) !== 0) return INVALID_BAD_SLOT
    if (tailCursor <= nextCursor) return INVALID_EXHAUSTED
    candidates[slot] = deck[--tailCursor]!
    refreshed |= 1 << slot
  }
  if (chosenId !== 0 && !candidates.includes(chosenId)) return INVALID_NOT_OFFERED
  return 0
}

/** No transaction: derives the selection from the last sealed real-choice anchor. */
export function resolvePaidAutomaticChoice(
  deck: readonly number[], state: PaidDrawState, seed: Hex, sealedAnchor: Hex, checkpoint: number,
): { state: PaidDrawState; cardId: number } {
  if (!state.automatic || state.forfeited) throw new Error('AUTOMATIC_CHOICE_DISABLED')
  const offered = consumePaidChoice(deck, state.cursor, [], 0)
  const index = Number(chainEntropy(seed, sealedAnchor, checkpoint, AUTOPICK_DOMAIN, 0n) % 3n)
  const cardId = offered.candidates[index]!
  return { state: applyCard({ ...state, cursor: offered.nextCursor }, cardId), cardId }
}
