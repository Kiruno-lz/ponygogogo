import { describe, expect, test } from 'bun:test'
import {
  encodeAbiParameters, encodeErrorResult, encodeEventTopics, keccak256, parseAbi, toHex, type Address, type Hex, type Log,
} from 'viem'
import type { CallAccount, CallProgress, ContractCall } from './alchemy.ts'
import { ponyGameAbi } from './paidCalls.ts'
import {
  choosePaidCard, errorReason, openPaidSession, PaidSessionError, parseCardChosen, parseSessionOpened,
  parseSessionSettled, readSettleDeadline, revertName, settlePaidSession, SPONSOR_QUOTA_REASON, type PaidChainDeps, type PaidSessionFacts,
  type SessionReader,
} from './paidSession.ts'

const GAME = '0x1111111111111111111111111111111111111111' as Address
const VAULT = '0x2222222222222222222222222222222222222222' as Address
const PLAYER = '0x3333333333333333333333333333333333333333' as Address
const OTHER = '0x4444444444444444444444444444444444444444' as Address
const SESSION = keccak256(toHex('session')) as Hex
const SEED = keccak256(toHex('seed')) as Hex
const BLOCK_HASH = keccak256(toHex('block-100')) as Hex
const ZERO = `0x${'00'.repeat(32)}` as Hex
const STAKE = 10n ** 18n // tier 2 = 1 MON

function eventLog(eventName: string, args: Record<string, unknown>, address: Address = GAME): Log {
  const item = ponyGameAbi.find((i) => i.type === 'event' && i.name === eventName) as { inputs: readonly { name: string; type: string; indexed?: boolean }[] }
  const topics = encodeEventTopics({ abi: ponyGameAbi, eventName: eventName as never, args: args as never }) as Hex[]
  const data = encodeAbiParameters(
    item.inputs.filter((i) => !i.indexed) as never,
    item.inputs.filter((i) => !i.indexed).map((i) => args[i.name]) as never,
  )
  return { address, topics: topics as [Hex, ...Hex[]], data, blockHash: BLOCK_HASH, blockNumber: 100n, logIndex: 0, transactionHash: keccak256(toHex('tx')), transactionIndex: 0, removed: false }
}

const opened = (player: Address, block = 100n) => eventLog('SessionOpened', {
  sessionId: SESSION, player, horseId: 2, stake: STAKE, seed: SEED, openedAt: 1_790_000_000n, openedBlock: block, rulesetHash: ZERO,
})
const chosen = (checkpoint: number, block = 100n) => eventLog('CardChosen', {
  sessionId: SESSION, player: PLAYER, checkpoint, cardId: 7, refreshSlots: [2], txSec: 31, blockNumber: block,
})
const settled = () => eventLog('SessionSettled', {
  sessionId: SESSION, player: PLAYER, finishTime: [1, 2, 3, 4, 5], rawOrder: [0, 1, 2, 3, 4], settlementOrder: [2, 0, 1, 3, 4],
  playerSettlementRank: 1, payout: 3n * STAKE, digest: keccak256(toHex('digest')), acquired: [7, 0, 21],
})
const junk: Log = { ...opened(PLAYER), address: OTHER, data: '0x1234' }

describe('receipt parsing', () => {
  test('SessionOpened: own log in a shared bundle; the open anchor is the receipt block hash', () => {
    const receipt = { status: 'success' as const, blockHash: BLOCK_HASH, blockNumber: 100n, logs: [junk, opened(OTHER), opened(PLAYER)] }
    expect(parseSessionOpened(receipt, GAME, PLAYER)).toEqual({
      sessionId: SESSION, player: PLAYER, state: 1, horseId: 2, stakeTier: 2, stake: STAKE, seed: SEED,
      openedAt: 1_790_000_000, openedBlock: 100n, openAnchor: BLOCK_HASH, choices: [null, null, null],
    })
    expect(parseSessionOpened({ ...receipt, logs: [opened(OTHER)] }, GAME, PLAYER)).toBeNull()
    expect(() => parseSessionOpened({ ...receipt, logs: [opened(PLAYER, 99n)] }, GAME, PLAYER)).toThrow('OPEN_BLOCK_MISMATCH')
  })

  test('CardChosen: matches session and checkpoint; anchor = block hash', () => {
    const receipt = { status: 'success' as const, blockHash: BLOCK_HASH, blockNumber: 100n, logs: [chosen(1), chosen(2)] }
    expect(parseCardChosen(receipt, GAME, SESSION, 2)).toEqual({
      checkpoint: 2, cardId: 7, refreshSlots: [2], txSec: 31, blockNumber: 100n, anchor: BLOCK_HASH,
    })
    expect(parseCardChosen(receipt, GAME, SESSION, 3)).toBeNull()
    expect(parseCardChosen(receipt, OTHER, SESSION, 1)).toBeNull()
    expect(() => parseCardChosen({ ...receipt, logs: [chosen(1, 7n)] }, GAME, SESSION, 1)).toThrow('CHOICE_BLOCK_MISMATCH')
  })

  test('SessionSettled: every field of the event', () => {
    const s = parseSessionSettled([junk, settled()], GAME, SESSION, keccak256(toHex('tx')), 100n)!
    expect(s).toMatchObject({
      rank: 1, payout: 3n * STAKE, finishTime: [1, 2, 3, 4, 5], rawOrder: [0, 1, 2, 3, 4], settlementOrder: [2, 0, 1, 3, 4],
      acquired: [7, 0, 21],
    })
    expect(parseSessionSettled([junk], GAME, SESSION, null, null)).toBeNull()
  })
})

describe('failure reasons', () => {
  const windowData = encodeErrorResult({ abi: ponyGameAbi, errorName: 'ForfeitTooEarly', args: [86_400n] })

  test('revert data anywhere in the cause chain decodes to the PonyGame error name', () => {
    expect(revertName({ message: 'x', cause: { cause: { data: windowData } } })).toBe('ForfeitTooEarly')
    expect(revertName({ data: { data: encodeErrorResult({ abi: ponyGameAbi, errorName: 'RaceNotFinished', args: [1n, 2] }) } })).toBe('RaceNotFinished')
    expect(revertName(new Error('execution reverted: ActiveSession()'))).toBe('ActiveSession')
    expect(revertName(new Error('nope'))).toBeNull()
    expect(revertName({ data: '0xdeadbeef' })).toBeNull()
  })

  test('Vault errors bubbling out of openSession decode too, also from hex embedded in a message', () => {
    const house = encodeErrorResult({ abi: parseAbi(['error InsufficientHouseLiquidity()']), errorName: 'InsufficientHouseLiquidity' })
    expect(revertName({ cause: { data: house } })).toBe('InsufficientHouseLiquidity')
    expect(revertName(new Error(`simulation failed: execution reverted with data ${house} at call 1`))).toBe('InsufficientHouseLiquidity')
  })

  test('a sponsor policy refusal becomes its own reason, wherever in the chain it sits', () => {
    const refusal = { shortMessage: 'RPC Request failed.', cause: { details: "Policy's max count per spender exceeded" } }
    expect(errorReason(refusal)).toBe(SPONSOR_QUOTA_REASON)
    expect(errorReason(new Error("Policy's max spend per spender exceeded"))).toBe(SPONSOR_QUOTA_REASON)
    expect(errorReason(new Error('policy not found'))).toBe('policy not found')
  })

  test('errorReason prefers the error name, then RPC details, one short line', () => {
    expect(errorReason({ data: windowData })).toBe('ForfeitTooEarly')
    expect(errorReason({ details: 'stubbed RPC outage', shortMessage: 'RPC Request failed.' })).toBe('stubbed RPC outage')
    expect(errorReason({ shortMessage: 'short' })).toBe('short')
    expect(errorReason(new Error(`${'a'.repeat(100)}\nsecond line`))).toBe('a'.repeat(80))
  })
})

// ------------------------------------------------------------------------------------------------ flows with fakes

type ChainState = {
  sessionOf: Hex
  available: bigint
  balance: bigint
  state: number
  choice: { present: boolean; txSec: number; blockNumber: bigint; cardId: number; refreshSlots: number[]; anchor: Hex } | null
  settledLogs: Log[]
}

function fakeReader(s: ChainState): SessionReader {
  const emptyChoice = { present: false, txSec: 0, blockNumber: 0n, cardId: 0, refreshSlots: [], anchor: ZERO }
  return {
    readContract: (async ({ functionName }: { functionName: string }) => {
      if (functionName === 'sessionOf') return s.sessionOf
      if (functionName === 'available') return s.available
      if (functionName === 'getSession') {
        return {
          player: PLAYER, state: s.state, playerHorseId: 2, stakeTier: 2, stake: STAKE, openedAt: 1_790_000_000n, openedBlock: 100n,
          seed: SEED, openAnchor: BLOCK_HASH, lastCheckpoint: s.choice ? 1 : 0,
          choices: [s.choice ?? emptyChoice, emptyChoice, emptyChoice],
        }
      }
      throw new Error(`unexpected read ${functionName}`)
    }) as never,
    getTransactionReceipt: (async () => { throw new Error('no receipt') }) as never,
    getBlock: (async (args: { blockNumber?: bigint }) => ({ hash: keccak256(toHex(`block-${args?.blockNumber ?? 'latest'}`)), number: 120n, timestamp: 0n })) as never,
    getLogs: (async () => s.settledLogs) as never,
    getBalance: (async () => s.balance) as never,
  }
}

function fakeAccount(onSend: (calls: readonly ContractCall[]) => string): CallAccount & { sent: ContractCall[][] } {
  const sent: ContractCall[][] = []
  return {
    sent,
    getAddress: () => PLAYER,
    send: async (calls) => { sent.push([...calls]); return onSend(calls) },
    progress: async (callId: string): Promise<CallProgress> => ({ state: 'pending', callId }),
  }
}

const facts: PaidSessionFacts = {
  sessionId: SESSION, player: PLAYER, state: 1, horseId: 2, stakeTier: 2, stake: STAKE, seed: SEED, openedAt: 1_790_000_000,
  openedBlock: 100n, openAnchor: BLOCK_HASH, choices: [null, null, null],
}

const deps = (s: ChainState, account: CallAccount): PaidChainDeps => ({
  account, client: fakeReader(s), game: GAME, vault: VAULT, poll: { pollMs: 1, timeoutMs: 5 }, now: () => 0,
})

describe('flows read the chain before trusting an uncertain outcome', () => {
  const base = (): ChainState => ({ sessionOf: ZERO, available: 0n, balance: 10n ** 18n, state: 1, choice: null, settledLogs: [] })

  test('open refuses while a session is unfinished and when the wallet cannot cover the shortfall', async () => {
    const acc = fakeAccount(() => 'call')
    const active = await openPaidSession(deps({ ...base(), sessionOf: SESSION }, acc), 2, STAKE).catch((e: unknown) => e)
    expect(active).toBeInstanceOf(PaidSessionError)
    expect(active).toMatchObject({ code: 'active-session', sessionId: SESSION })
    const poor = await openPaidSession(deps({ ...base(), available: STAKE / 2n, balance: 1n }, acc), 2, STAKE).catch((e: unknown) => e)
    expect(poor).toMatchObject({ code: 'insufficient-wallet', detail: String(STAKE / 2n) })
    expect(acc.sent).toEqual([])
  })

  test('open maps the house-liquidity revert and the sponsor quota refusal to their own codes', async () => {
    const house = encodeErrorResult({ abi: parseAbi(['error InsufficientHouseLiquidity()']), errorName: 'InsufficientHouseLiquidity' })
    const noHouse = await openPaidSession(deps({ ...base(), available: STAKE }, fakeAccount(() => { throw { message: 'x', data: house } })), 2, STAKE)
      .catch((e: unknown) => e)
    expect(noHouse).toMatchObject({ code: 'house-liquidity', detail: 'InsufficientHouseLiquidity' })
    const quota = await openPaidSession(
      deps({ ...base(), available: STAKE }, fakeAccount(() => { throw new Error("Policy's max count per spender exceeded") })), 2, STAKE,
    ).catch((e: unknown) => e)
    expect(quota).toMatchObject({ code: 'sponsor-quota', detail: SPONSOR_QUOTA_REASON })
  })

  test('a thrown send whose choice is on chain anyway is reported as included, with its block hash as anchor', async () => {
    const s = base()
    const acc = fakeAccount(() => {
      s.choice = { present: true, txSec: 33, blockNumber: 110n, cardId: 7, refreshSlots: [], anchor: ZERO }
      throw new Error('network dropped after submit')
    })
    const steps: string[] = []
    const out = await choosePaidCard(deps(s, acc), facts, 1, 7, [], (st) => steps.push(st.phase))
    expect(out).toMatchObject({ state: 'included', hash: null, choice: { checkpoint: 1, txSec: 33, cardId: 7, anchor: keccak256(toHex('block-110')) } })
    expect(steps).toEqual(['signing', 'included'])
  })

  test('a timed-out choice with no chain record is unknown; a refused one carries the reason', async () => {
    const unknown = await choosePaidCard(deps(base(), fakeAccount(() => 'call')), facts, 1, 7, [])
    expect(unknown.state).toBe('unknown')
    const refused = await choosePaidCard(deps(base(), fakeAccount(() => { throw { message: 'x', data: encodeErrorResult({ abi: ponyGameAbi, errorName: 'InvalidCheckpoint' }) } })), facts, 1, 7, [])
    expect(refused).toMatchObject({ state: 'rejected', reason: 'InvalidCheckpoint' })
  })

  test('settle returns an existing settlement from the logs without sending anything', async () => {
    const acc = fakeAccount(() => 'call')
    const out = await settlePaidSession(deps({ ...base(), state: 2, settledLogs: [settled()] }, acc), facts)
    expect(out.state).toBe('settled')
    expect(acc.sent).toEqual([])
    const forfeited = await settlePaidSession(deps({ ...base(), state: 3 }, acc), facts)
    expect(forfeited).toEqual({ state: 'failed', reason: 'FORFEITED', hash: null })
  })

  test('the settlement deadline reads getSession and the head; a closed session has none', async () => {
    // the fake head is block 120 and every stored anchor is sealed except the choice at block 110
    const s = { ...base(), choice: { present: true, txSec: 33, blockNumber: 110n, cardId: 7, refreshSlots: [], anchor: ZERO } }
    expect(await readSettleDeadline(fakeReader(s), GAME, SESSION)).toMatchObject({ state: 'open', anchorBlock: 110n, blocksLeft: 8181n })
    expect(await readSettleDeadline(fakeReader(base()), GAME, SESSION)).toEqual({ state: 'sealed' })
    expect(await readSettleDeadline(fakeReader({ ...base(), state: 2 }), GAME, SESSION)).toBeNull()
  })
})

describe('happy paths parse the receipts of the included calls', () => {
  function includedAccount(hashes: Hex[]): CallAccount {
    return {
      getAddress: () => PLAYER,
      send: async () => 'call-1',
      progress: async (callId: string): Promise<CallProgress> => ({ state: 'included', callId, transactionHashes: hashes }),
    }
  }

  function withReceipts(s: ChainState, logs: Log[]): SessionReader {
    return {
      ...fakeReader(s),
      getTransactionReceipt: (async () => ({ status: 'success', blockHash: BLOCK_HASH, blockNumber: 100n, logs })) as never,
    }
  }

  const base = (): ChainState => ({ sessionOf: ZERO, available: STAKE, balance: 0n, state: 1, choice: null, settledLogs: [] })
  const TX = keccak256(toHex('tx-1'))

  test('open: available covers the stake, so only openSession is sent; facts come from SessionOpened', async () => {
    const acc = includedAccount([TX])
    const sent: ContractCall[][] = []
    const spy: CallAccount = { ...acc, send: async (calls) => { sent.push([...calls]); return 'call-1' } }
    const steps: string[] = []
    const out = await openPaidSession({ ...deps(base(), spy), client: withReceipts(base(), [opened(OTHER), opened(PLAYER)]) }, 2, STAKE, (st) => steps.push(st.phase))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(1)
    expect(out).toMatchObject({ hash: TX, facts: { sessionId: SESSION, openAnchor: BLOCK_HASH, openedBlock: 100n } })
    expect(steps).toEqual(['signing', 'submitted', 'included'])
  })

  test('choose and settle read CardChosen / SessionSettled from the receipt', async () => {
    const reader = withReceipts(base(), [chosen(1), settled()])
    const choice = await choosePaidCard({ ...deps(base(), includedAccount([TX])), client: reader }, facts, 1, 7, [2])
    expect(choice).toMatchObject({ state: 'included', hash: TX, choice: { txSec: 31, anchor: BLOCK_HASH, refreshSlots: [2] } })
    const settle = await settlePaidSession({ ...deps(base(), includedAccount([TX])), client: reader }, facts)
    expect(settle).toMatchObject({ state: 'settled', settlement: { rank: 1, hash: TX, blockNumber: 100n } })
  })

  test('recovery: no session is null; unsealed anchors are read from the blocks', async () => {
    const { recoverPaidSession, readSessionFacts } = await import('./paidSession.ts')
    expect(await recoverPaidSession(fakeReader(base()), GAME, PLAYER)).toBeNull()
    const s = { ...base(), sessionOf: SESSION, choice: { present: true, txSec: 40, blockNumber: 130n, cardId: 5, refreshSlots: [1], anchor: ZERO } }
    const got = await recoverPaidSession(fakeReader(s), GAME, PLAYER)
    expect(got?.choices[0]).toEqual({ checkpoint: 1, cardId: 5, refreshSlots: [1], txSec: 40, blockNumber: 130n, anchor: keccak256(toHex('block-130')) })
    expect(await recoverPaidSession(fakeReader({ ...s, state: 2 }), GAME, PLAYER)).toBeNull()
    await expect(readSessionFacts(fakeReader({ ...s, state: 0 }), GAME, SESSION)).rejects.toThrow('not-open')
  })
})
