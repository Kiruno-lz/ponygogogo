/** Compatibility view for card rendering; all names and descriptions come from the canonical paid pool. */
import { PAID_CARD_POOL } from './paidCards.ts'
import type { CardDef } from './types.ts'

export const CARD_POOL: CardDef[] = PAID_CARD_POOL.map(card => ({ ...card, effects: [] }))
export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARD_POOL.map(card => [card.cardId, card]))
