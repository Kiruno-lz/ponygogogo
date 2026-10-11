import {
  decodeEventLog,
  isAddressEqual,
  type Address,
  type Hex,
  type Log
} from 'viem'
import { normalizeRoster } from '../race/core/roster.ts'
import { PAID_RULESET_HASH } from '../race/paid/cardRules.ts'
import {
  ponyGameAbi, SESSION_STATE
} from './paidCalls.ts'
import { paidTierForStake } from './paidStakes.ts'
import { collectibleGrantFromLogs, readRewardsAddress } from './rewards.ts'
import { errorReason, PaidChoiceFact, PaidChoiceFacts, PaidSessionError, PaidSessionFacts, PaidSettlementFacts, PaidTier, SessionReader, ZERO_HASH } from './sessionProtocol.ts'
import { settleDeadline, type SettleDeadline } from './settleDeadline.ts'

export type ReceiptLike = { status: 'success' | 'reverted'; blockHash: Hex; blockNumber: bigint; logs: readonly Log[] }

// ---------------------------------------------------------------------------------------------- pure parsing

export type OpenedArgs = {
  sessionId: Hex; player: Address; horseId: number; stake: bigint; seed: Hex; openedAt: bigint; openedBlock: bigint
  roster: readonly number[]
}

export type ChosenArgs = {
  sessionId: Hex; player: Address; checkpoint: number; cardId: number; refreshSlots: readonly number[]; txSec: number
  blockNumber: bigint
}

export type SettledArgs = {
  sessionId: Hex; player: Address; finishTime: readonly number[]; rawOrder: readonly number[]
  settlementOrder: readonly number[]; playerSettlementRank: number; payout: bigint; digest: Hex
  acquired: readonly number[]
}

export function gameEvents<T>(logs: readonly Log[], game: Address, eventName: string): T[] {
  const out: T[] = []
  for (const log of logs) {
    if (!isAddressEqual(log.address, game)) continue
    {
      try {
        const decoded = decodeEventLog({ abi: ponyGameAbi, data: log.data, topics: log.topics })
        if (decoded.eventName === eventName) out.push(decoded.args as T)
      } catch {
        // Skip unrelated events in the bundle.
      }
    }
  }
  return out
}

/** 从开场回执里取本账户的 SessionOpened；开场锚 = 回执所在块的哈希（块号必须与事件一致）。 */
export function parseSessionOpened(receipt: ReceiptLike, game: Address, player: Address): PaidSessionFacts | null {
  const opened = gameEvents<OpenedArgs>(receipt.logs, game, 'SessionOpened').find((e) => isAddressEqual(e.player, player))
  if (!opened) return null
  if (opened.openedBlock !== receipt.blockNumber) throw new PaidSessionError('missing-event', 'OPEN_BLOCK_MISMATCH')
  return {
    sessionId: opened.sessionId,
    player: opened.player,
    state: SESSION_STATE.open,
    horseId: opened.horseId,
    stakeTier: paidTierForStake(opened.stake),
    stake: opened.stake,
    seed: opened.seed,
    openedAt: Number(opened.openedAt),
    openedBlock: opened.openedBlock,
    openAnchor: receipt.blockHash,
    choices: [null, null, null],
    roster: normalizeRoster(opened.roster),
  }
}

export function parseCardChosen(receipt: ReceiptLike, game: Address, sessionId: Hex, checkpoint: number): PaidChoiceFact | null {
  const chosen = gameEvents<ChosenArgs>(receipt.logs, game, 'CardChosen')
    .find((e) => e.sessionId.toLowerCase() === sessionId.toLowerCase() && e.checkpoint === checkpoint)
  if (!chosen) return null
  if (chosen.blockNumber !== receipt.blockNumber) throw new PaidSessionError('missing-event', 'CHOICE_BLOCK_MISMATCH')
  return {
    checkpoint: chosen.checkpoint as 1 | 2 | 3,
    cardId: chosen.cardId,
    refreshSlots: [...chosen.refreshSlots],
    txSec: chosen.txSec,
    blockNumber: chosen.blockNumber,
    anchor: receipt.blockHash,
  }
}

export function parseSessionSettled(
  logs: readonly Log[], game: Address, sessionId: Hex, hash: Hex | null, blockNumber: bigint | null,
  ledger: Address | null = null,
): PaidSettlementFacts | null {
  const settled = gameEvents<SettledArgs>(logs, game, 'SessionSettled')
    .find((e) => e.sessionId.toLowerCase() === sessionId.toLowerCase())
  if (!settled) return null
  return {
    sessionId: settled.sessionId,
    player: settled.player,
    finishTime: [...settled.finishTime],
    rawOrder: [...settled.rawOrder],
    settlementOrder: [...settled.settlementOrder],
    rank: settled.playerSettlementRank,
    payout: settled.payout,
    digest: settled.digest,
    acquired: [...settled.acquired],
    hash,
    blockNumber,
    grant: ledger ? collectibleGrantFromLogs(logs, ledger, sessionId, settled.player) : null,
  }
}

/** Do not turn an RPC failure into a no-grant fact. Closed sessions must be recovered, never sent again. */
export async function refreshSettlementReward(client: SessionReader, game: Address, settlement: PaidSettlementFacts, logs?: readonly Log[]): Promise<PaidSettlementFacts> {
  const rules = await client.readContract({ address: game, abi: ponyGameAbi, functionName: 'rulesetHash' })
  if (rules.toLowerCase() !== PAID_RULESET_HASH.toLowerCase()) throw new PaidSessionError('ruleset-mismatch')
  const ledger = await readRewardsAddress(client, game)
  if (!logs) {
    if (!settlement.hash) throw new PaidSessionError('missing-event', 'SETTLEMENT_TRANSACTION_MISSING', settlement.sessionId)
    logs = (await client.getTransactionReceipt({ hash: settlement.hash })).logs
  }
  return { ...settlement, grant: collectibleGrantFromLogs(logs, ledger, settlement.sessionId, settlement.player), grantError: null }
}

export async function settlementReward(client: SessionReader, game: Address, settlement: PaidSettlementFacts, logs?: readonly Log[]): Promise<PaidSettlementFacts> {
  try { return await refreshSettlementReward(client, game, settlement, logs) }
  catch (error) { return { ...settlement, grant: undefined, grantError: errorReason(error) } }
}

// ---------------------------------------------------------------------------------------------- reads

export type ChoiceView = {
  present: boolean; txSec: number; blockNumber: bigint; cardId: number; refreshSlots: readonly number[]; anchor: Hex
}

export type SessionView = {
  player: Address; state: number; playerHorseId: number; stakeTier: number; stake: bigint; openedAt: bigint
  openedBlock: bigint; seed: Hex; openAnchor: Hex; lastCheckpoint: number; choices: readonly ChoiceView[]
  roster: readonly number[]
}

export async function readSessionOf(client: SessionReader, game: Address, player: Address): Promise<Hex> {
  return await client.readContract({ address: game, abi: ponyGameAbi, functionName: 'sessionOf', args: [player] })
}

export async function readSessionView(client: SessionReader, game: Address, sessionId: Hex): Promise<SessionView> {
  const rules = await client.readContract({ address: game, abi: ponyGameAbi, functionName: 'rulesetHash' })
  if (rules.toLowerCase() !== PAID_RULESET_HASH.toLowerCase()) throw new PaidSessionError('ruleset-mismatch')
  const view = await client.readContract({
    address: game, abi: ponyGameAbi, functionName: 'getSession', args: [sessionId],
  }) as unknown as SessionView
  if (view.state !== SESSION_STATE.none && !Array.isArray(view.roster)) throw new PaidSessionError('missing-event', 'INVALID_SESSION_ROSTER')
  return view
}

export async function blockHash(client: SessionReader, blockNumber: bigint): Promise<Hex> {
  const block = await client.getBlock({ blockNumber })
  if (!block.hash) throw new PaidSessionError('missing-event', `NO_BLOCK_HASH_${blockNumber}`)
  return block.hash
}

export function choiceFact(k: number, view: ChoiceView, anchor: Hex): PaidChoiceFact {
  return {
    checkpoint: k as 1 | 2 | 3,
    cardId: view.cardId,
    refreshSlots: [...view.refreshSlots],
    txSec: view.txSec,
    blockNumber: view.blockNumber,
    anchor,
  }
}

/** 从 getSession 重建全部链上事实；未封存的锚由 RPC 读对应块哈希（与合约 RandomAnchor 读到的是同一个）。 */
export async function readSessionFacts(client: SessionReader, game: Address, sessionId: Hex): Promise<PaidSessionFacts> {
  const view = await readSessionView(client, game, sessionId)
  if (view.state === SESSION_STATE.none) throw new PaidSessionError('not-open', 'UNKNOWN_SESSION', sessionId)
  // 缺锚的块哈希彼此独立，并行读；失败仍按开场锚、第 1/2/3 个选择的先后报第一个，与逐个读时一致
  const reads = await Promise.allSettled([
    view.openAnchor !== ZERO_HASH ? view.openAnchor : blockHash(client, view.openedBlock),
    ...[0, 1, 2].map((i) => {
      const c = view.choices[i]!
      return !c.present ? null : c.anchor !== ZERO_HASH ? c.anchor : blockHash(client, c.blockNumber)
    }),
  ])
  const anchors = reads.map((r) => {
    if (r.status === 'rejected') throw r.reason
    return r.value
  })
  const openAnchor = anchors[0]!
  const choices: PaidChoiceFacts = [null, null, null]
  for (let i = 0; i < 3; i++) {
    const anchor = anchors[i + 1]
    if (anchor) choices[i] = choiceFact(i + 1, view.choices[i]!, anchor)
  }
  return {
    sessionId,
    player: view.player,
    state: view.state,
    horseId: view.playerHorseId,
    stakeTier: view.stakeTier as PaidTier,
    stake: view.stake,
    seed: view.seed,
    openedAt: Number(view.openedAt),
    openedBlock: view.openedBlock,
    openAnchor,
    choices,
    roster: normalizeRoster(view.roster),
  }
}

/** 刷新恢复：账户当前未完结的会话；没有返回 null。 */
export async function recoverPaidSession(client: SessionReader, game: Address, player: Address): Promise<PaidSessionFacts | null> {
  const sessionId = await readSessionOf(client, game, player)
  if (sessionId === ZERO_HASH) return null
  const facts = await readSessionFacts(client, game, sessionId)
  return facts.state === SESSION_STATE.open ? facts : null
}

/** 已结算会话的 SessionSettled；分段扫日志，从开场块起。 */
export async function findSettlement(
  client: SessionReader, game: Address, sessionId: Hex, fromBlock: bigint, chunk = 90n,
): Promise<PaidSettlementFacts | null> {
  const head = (await client.getBlock({ blockTag: 'latest' })).number ?? fromBlock
  const event = ponyGameAbi.find((i) => i.type === 'event' && i.name === 'SessionSettled')!
  for (let start = fromBlock; start <= head; start += chunk) {
    const end = start + chunk - 1n < head ? start + chunk - 1n : head
    const logs = await client.getLogs({
      address: game, event: event as never, args: { sessionId } as never, fromBlock: start, toBlock: end,
    }) as unknown as Log[]
    const found = logs.length > 0
      ? parseSessionSettled(logs, game, sessionId, logs[0]!.transactionHash ?? null, logs[0]!.blockNumber ?? null)
      : null
    if (found) return settlementReward(client, game, found)
  }
  return null
}

/**
 * 结算期限：getSession 里最早未封存的所需锚 + 8191 块，按本会话实测的块时间折算（settleDeadline.ts）。
 * 读不到返回 null——期限只是提示，不影响结算流程。
 */
export async function readSettleDeadline(client: SessionReader, game: Address, sessionId: Hex): Promise<SettleDeadline | null> {
  try {
    const [view, head] = await Promise.all([
      readSessionView(client, game, sessionId), client.getBlock({ blockTag: 'latest' }),
    ])
    if (view.state !== SESSION_STATE.open || head.number === null) return null
    return settleDeadline(view, { number: head.number, timestamp: head.timestamp })
  } catch {
    return null
  }
}
