import { expect, test } from 'bun:test'
import { decodeFunctionData, type Address, type Hex } from 'viem'
import { LEGACY_PAID_RULESET_HASH, PAID_RULESET_HASH } from '../race/paid/cardRules.ts'
import { ponyGameAbi } from './paidCalls.ts'
import { choosePaidCard, type SessionReader } from './paidSession.ts'
import { recoverPaidSessions, sessionChainDeps } from './paidRecovery.ts'
import { parseLegacyGames } from './network.ts'

const CURRENT = '0x1111111111111111111111111111111111111111' as Address
const OLD = '0x2222222222222222222222222222222222222222' as Address
const PLAYER = '0x4444444444444444444444444444444444444444' as Address
const ID = `0x${'11'.repeat(32)}` as Hex
const ZERO = `0x${'00'.repeat(32)}` as Hex
const empty = { present: false, txSec: 0, blockNumber: 0n, cardId: 0, refreshSlots: [], anchor: ZERO }
function reader(): SessionReader {
  return { readContract: (async ({ address, functionName }: { address: Address; functionName: string }) => {
    if (functionName === 'sessionOf') return address === OLD ? ID : ZERO
    if (functionName === 'rulesetHash') return address === OLD ? LEGACY_PAID_RULESET_HASH : PAID_RULESET_HASH
    if (functionName === 'getSession') return { player: PLAYER, state: 1, playerHorseId: 2, stakeTier: 1, stake: 5n * 10n ** 16n,
      openedAt: 100n, openedBlock: 20n, seed: ID, openAnchor: ID, lastCheckpoint: 0, choices: [empty,empty,empty] }
    throw Error(functionName)
  }) as never, getBlock: (async () => ({ hash: ID })) as never, getLogs: (async () => []) as never,
    getBalance: (async () => 0n) as never, getTransactionReceipt: (async () => { throw Error('unused') }) as never }
}

test('legacy Game configuration normalizes and deduplicates trusted build addresses', () => {
  expect(parseLegacyGames(` ${OLD},${OLD},${CURRENT} `)).toEqual([OLD,CURRENT])
  expect(parseLegacyGames('')).toEqual([])
  for (const bad of ['not-an-address', `${OLD},nope`, `0x${'00'.repeat(20)}`]) expect(() => parseLegacyGames(bad)).toThrow('INVALID_LEGACY_GAME_ADDRESSES')
})

test('recovers an old active session and pins its own Game', async () => {
  const contexts = await recoverPaidSessions(reader(), [CURRENT,OLD,OLD], PLAYER)
  expect(contexts).toHaveLength(1)
  expect(contexts[0]).toMatchObject({ game: OLD, facts: { sessionId: ID, player: PLAYER } })
  expect(contexts[0]!.facts.roster).toBeUndefined()
  expect(Object.isFrozen(contexts[0])).toBe(true)
})

test('an RPC failure cannot be mistaken for absence of an old unfinished session', async () => {
  const client = reader()
  client.readContract = (async () => { throw Error('rpc offline') }) as never
  await expect(recoverPaidSessions(client, [OLD], PLAYER)).rejects.toThrow('rpc offline')
})

test('a recovered choice is sent to its pinned Game even when the current entry address changed', async () => {
  const client = reader()
  const [context] = await recoverPaidSessions(client, [CURRENT,OLD], PLAYER)
  let target: Address | undefined
  const account = { getAddress: () => PLAYER, send: async (calls: { to: Address; data: Hex }[]) => {
    target = calls[0]!.to
    expect(decodeFunctionData({ abi: ponyGameAbi, data: calls[0]!.data }).functionName).toBe('chooseCard')
    throw Error('simulation rejected')
  } } as never
  const deps = sessionChainDeps({ client, account, game: CURRENT }, context!)
  expect(deps.game).toBe(OLD)
  await choosePaidCard(deps, context!.facts, 1, 4, [])
  expect(target).toBe(OLD)
})
