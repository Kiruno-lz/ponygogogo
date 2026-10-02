import { keccak256, toBytes, type Hex } from 'viem'
import { chainEntropy } from './chainEntropy.ts'
import { PAID_CPU_MASK, PAID_CARD_COUNT } from '../paid/cardRules.ts'

export const CPU_CARD_MASK = PAID_CPU_MASK
const PURPOSE_CPU_CARD = keccak256(toBytes('cpu.card'))

/** Three private cards for one CPU horse, drawn without replacement. */
export function derivePaidCpuDeck(seed: Hex, anchor: Hex, horseId: number): number[] {
  if (!Number.isInteger(horseId) || horseId < 0 || horseId > 4) throw new Error('INVALID_HORSE')
  const remaining: number[] = []
  for (let id = 1; id <= PAID_CARD_COUNT; id++) if ((CPU_CARD_MASK & (1n << BigInt(id - 1))) !== 0n) remaining.push(id)
  const deck: number[] = []
  for (let position = 0; position < 3; position++) {
    const eventIndex = BigInt(horseId * 3 + position)
    const index = Number(chainEntropy(seed, anchor, 0, PURPOSE_CPU_CARD, eventIndex) % BigInt(remaining.length))
    deck.push(remaining.splice(index, 1)[0]!)
  }
  return deck
}
