import { expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type PublicClient } from 'viem'
import { collectibleGrantFromLogs, ponyRewardsAbi, readOwnedCollection } from './rewards.ts'
import { collectionFromMask } from './collectionProgress.ts'

const game: Address = '0x0000000000000000000000000000000000000001'
const ledger: Address = '0x0000000000000000000000000000000000000002'
const player: Address = '0x0000000000000000000000000000000000000003'
const sessionId: Hex = `0x${'12'.repeat(32)}`
const log = (address: Address, assetKind = 1, assetId = 8) => ({ address,
  topics: encodeEventTopics({ abi: ponyRewardsAbi, eventName: 'CollectibleGranted', args: { sessionId, player } }).filter((topic): topic is Hex => typeof topic === 'string'),
  data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }], [assetKind, assetId]) })

test('grants are taken only from the configured ledger for this session and player', () => {
  expect(collectibleGrantFromLogs([log(game), log(ledger)], ledger, sessionId, player))
    .toEqual({ sessionId, player, assetKind: 'pony', assetId: 8 })
  expect(collectibleGrantFromLogs([log(ledger)], game, sessionId, player)).toBeNull()
  expect(collectibleGrantFromLogs([log(ledger)], ledger, `0x${'34'.repeat(32)}`, player)).toBeNull()
  expect(collectibleGrantFromLogs([log(ledger)], ledger, sessionId, game)).toBeNull()
  expect(collectibleGrantFromLogs([log(ledger, 0, 2)], ledger, sessionId, player)?.assetKind).toBe('rareCard')
})

test('authoritative mask lookup gets ledger from Game and keeps the sma-b owner separate from caller', async () => {
  const calls: { address: string; functionName: string; abi?: readonly unknown[]; args?: readonly unknown[] }[] = []
  const mask = (1n << 2n) | (1n << 72n)
  const client = { readContract: async (call: typeof calls[number]) => { calls.push(call); return call.functionName === 'rewards' ? ledger : mask } }
  expect(await readOwnedCollection(client as unknown as PublicClient, game, player)).toEqual({ ledger, progress: collectionFromMask(mask) })
  expect(calls).toEqual([{ address: game, abi: expect.anything(), functionName: 'rewards' },
    { address: ledger, abi: expect.anything(), functionName: 'ownedMask', args: [player] }])
})
