/** Consume one three-card offer and its authorized refresh actions. 0 means forfeit. */
export function consumePaidChoice(deck: readonly number[], cursor: number, refreshSlots: readonly number[], chosenId: number) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor + 3 > deck.length) throw new Error('DECK_EXHAUSTED')
  const candidates = deck.slice(cursor, cursor + 3)
  let nextCursor = cursor + 3
  let refreshed = 0
  for (const slot of refreshSlots) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 2 || (refreshed & (1 << slot)) !== 0 || nextCursor >= deck.length) {
      throw new Error('INVALID_REFRESH')
    }
    candidates[slot] = deck[nextCursor++]!
    refreshed |= 1 << slot
  }
  if (chosenId !== 0 && !candidates.includes(chosenId)) throw new Error('CARD_NOT_OFFERED')
  return { candidates, nextCursor }
}
