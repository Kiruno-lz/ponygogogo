import { decodeEventLog, isAddressEqual, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import { PAID_CARD_RULES } from '../race/paid/cardRules.ts'
import { PONY_RULES } from '../race/paid/ponyRules.ts'
import { DEFAULT_ROSTER } from '../race/core/roster.ts'
import { collectionFromMask, normalizeCollection, type CollectionProgress } from './collectionProgress.ts'

export const ponyRewardsAbi = parseAbi([
  'function ownedMask(address player) view returns (uint256)',
  'event CollectibleGranted(bytes32 indexed sessionId, address indexed player, uint8 assetKind, uint8 assetId)',
])
const gameRewardsAbi = parseAbi(['function rewards() view returns (address)'])
export type CollectibleGrant = { sessionId: Hex; player: Address; assetKind: 'rareCard' | 'pony'; assetId: number }
type CollectibleLog = { address: Address; topics: readonly Hex[]; data: Hex }

export async function readRewardsAddress(client: Pick<PublicClient, 'readContract'>, game: Address): Promise<Address> {
  const ledger = await client.readContract({ address: game, abi: gameRewardsAbi, functionName: 'rewards' })
  if (isAddressEqual(ledger, zeroAddress)) throw new Error('INVALID_REWARDS_LEDGER')
  return ledger
}

export async function readOwnedCollection(client: PublicClient, game: Address, player: Address): Promise<{ ledger: Address; progress: CollectionProgress }> {
  const ledger = await readRewardsAddress(client, game)
  const mask = await client.readContract({ address: ledger, abi: ponyRewardsAbi, functionName: 'ownedMask', args: [player] })
  return { ledger, progress: collectionFromMask(mask) }
}

export function collectibleGrantFromLogs(logs: readonly CollectibleLog[], ledger: Address, sessionId: Hex, player: Address): CollectibleGrant | null {
  for (const log of logs) {
    if (!isAddressEqual(log.address, ledger) || !log.topics.length) continue
    let event
    try { event = decodeEventLog({ abi: ponyRewardsAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] }) }
    catch { continue }
    if (event.eventName !== 'CollectibleGranted' || event.args.sessionId.toLowerCase() !== sessionId.toLowerCase()
      || !isAddressEqual(event.args.player, player)) continue
    const kind = Number(event.args.assetKind), id = Number(event.args.assetId)
    // The shared ledger outlives catalog revisions; accept historical grants by known identity.
    if (!(kind === 0 ? PAID_CARD_RULES.some(c => c.id === id)
      : kind === 1 && PONY_RULES.some(p => p.id === id && !DEFAULT_ROSTER.includes(id)))) throw new Error('UNKNOWN_COLLECTIBLE')
    return { sessionId, player, assetKind: kind === 0 ? 'rareCard' : 'pony', assetId: id }
  }
  return null
}

export function collectionFromGrant(grant: CollectibleGrant): CollectionProgress {
  return normalizeCollection({ schemaVersion: 2,
    rareCardIds: grant.assetKind === 'rareCard' ? [`C-${String(grant.assetId).padStart(2, '0')}`] : [],
    unlockedPonyIds: grant.assetKind === 'pony' ? [grant.assetId] : [],
  })
}
