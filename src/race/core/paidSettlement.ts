/** Ranks computed only from canonical five-horse finish times and acquired cards. */
export function paidSettlement(
  finishMs: readonly bigint[], playerHorseId: number, acquiredCards: readonly number[],
) {
  if (finishMs.length !== 5 || !Number.isInteger(playerHorseId) || playerHorseId < 0 || playerHorseId > 4) {
    throw new Error('INVALID_SETTLEMENT_INPUT')
  }
  const rawOrder = [0, 1, 2, 3, 4].sort((a, b) =>
    finishMs[a]! < finishMs[b]! ? -1 : finishMs[a]! > finishMs[b]! ? 1 : a - b)
  const versionAnswer = (acquiredCards.includes(17) || acquiredCards.includes(18))
    && acquiredCards.includes(19) && acquiredCards.includes(21)
  const settlementOrder = versionAnswer
    ? [playerHorseId, ...rawOrder.filter((id) => id !== playerHorseId)]
    : [...rawOrder]
  return {
    rawOrder,
    settlementOrder,
    rawRank: rawOrder.indexOf(playerHorseId) + 1,
    settlementRank: settlementOrder.indexOf(playerHorseId) + 1,
    versionAnswer,
  }
}
