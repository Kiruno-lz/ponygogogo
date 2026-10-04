import { PAID_CARD_RULES } from '../race/paid/cardRules.ts'
import { PONY_RULES } from '../race/paid/ponyRules.ts'
import { DEFAULT_ROSTER } from '../race/core/roster.ts'

export type CollectionProgress = { schemaVersion: 2; rareCardIds: string[]; unlockedPonyIds: number[] }
// Validate identity, not today's rarity: a later common/rare rebalance cannot revoke earned records.
const collectionCardIds = new Set(PAID_CARD_RULES.map(c => `C-${String(c.id).padStart(2, '0')}`))
const extraPonies = new Set(PONY_RULES.filter(p => !DEFAULT_ROSTER.includes(p.id)).map(p => p.id))

export function emptyCollection(): CollectionProgress {
  return { schemaVersion: 2, rareCardIds: [], unlockedPonyIds: [] }
}

/** The old plaintext array is migrated in memory only; invalid data never becomes empty progress. */
export function normalizeCollection(value: unknown): CollectionProgress {
  if (Array.isArray(value)) value = { schemaVersion: 2, rareCardIds: value, unlockedPonyIds: [] }
  if (!value || typeof value !== 'object' || (value as CollectionProgress).schemaVersion !== 2) throw new Error('INVALID_COLLECTION_SCHEMA')
  const { rareCardIds, unlockedPonyIds } = value as CollectionProgress
  if (!Array.isArray(rareCardIds) || rareCardIds.some(id => typeof id !== 'string' || !collectionCardIds.has(id))) throw new Error('INVALID_RARE_CARD')
  if (!Array.isArray(unlockedPonyIds) || unlockedPonyIds.some(id => !Number.isInteger(id) || !extraPonies.has(id))) throw new Error('INVALID_COLLECTION_PONY')
  return { schemaVersion: 2, rareCardIds: [...new Set(rareCardIds)].sort(), unlockedPonyIds: [...new Set(unlockedPonyIds)].sort((a, b) => a - b) }
}

export function mergeCollections(...documents: readonly CollectionProgress[]): CollectionProgress {
  const normalized = documents.map(normalizeCollection)
  return normalizeCollection({ schemaVersion: 2, rareCardIds: normalized.flatMap(p => p.rareCardIds), unlockedPonyIds: normalized.flatMap(p => p.unlockedPonyIds) })
}

/** Reward ledger layout: card bit = cardId; role bit = 64 + ponyId. */
export function collectionFromMask(mask: bigint): CollectionProgress {
  if (mask < 0n) throw new Error('INVALID_COLLECTION_MASK')
  const known = [...PAID_CARD_RULES.map(card => card.id), ...[...extraPonies].map(id => 64 + id)]
    .reduce((bits, id) => bits | (1n << BigInt(id)), 0n)
  if ((mask & ~known) !== 0n) throw new Error('UNKNOWN_COLLECTIBLE')
  return normalizeCollection({ schemaVersion: 2,
    rareCardIds: [...collectionCardIds].filter(id => (mask & (1n << BigInt(Number(id.slice(2))))) !== 0n),
    unlockedPonyIds: [...extraPonies].filter(id => (mask & (1n << BigInt(64 + id))) !== 0n),
  })
}
