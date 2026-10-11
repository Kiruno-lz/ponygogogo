import {
  type Address,
  type Hex
} from 'viem'
import { DEFAULT_ROSTER } from '../race/core/roster.ts'
import { PAID_RULESET_HASH } from '../race/paid/cardRules.ts'
import { type CallAccount, type CallProgress } from './alchemy.ts'
import { trackCall } from './funds.ts'
import {
  SESSION_STATE,
  chooseCardCall, openSessionCall, ponyGameAbi,
  settleSessionCall,
} from './paidCalls.ts'
import { paidTierForStake } from './paidStakes.ts'
import { PaidChainDeps, PaidChoiceFact, PaidSessionError, PaidSessionErrorCode, PaidSessionFacts, PaidSettlementFacts, PaidTxStep, SPONSOR_QUOTA_REASON, ZERO_HASH, errorReason } from './sessionProtocol.ts'
import { ReceiptLike, blockHash, choiceFact, findSettlement, parseCardChosen, parseSessionOpened, parseSessionSettled, readSessionFacts, readSessionOf, readSessionView, settlementReward } from './sessionReads.ts'
export * from './sessionProtocol.ts'
export { findSettlement, parseCardChosen, parseSessionOpened, parseSessionSettled, readSessionFacts, readSessionOf, readSessionView, readSettleDeadline, recoverPaidSession, refreshSettlementReward } from './sessionReads.ts'

// ---------------------------------------------------------------------------------------------- flows

function requirePlayer(account: CallAccount): Address {
  const player = account.getAddress()
  if (!player) throw new PaidSessionError('account-not-resolved')
  return player
}

type Tracked = CallProgress | { state: 'timeout'; callId: string }

function lastHash(progress: Tracked | null): Hex | null {
  if (!progress || progress.state === 'pending' || progress.state === 'timeout') return null
  return progress.transactionHashes.at(-1) ?? null
}

type Submitted = { progress: Tracked | null; sendError: unknown; submittedAt: number }

async function submit(deps: PaidChainDeps, calls: Parameters<CallAccount['send']>[0], onStep?: (s: PaidTxStep) => void): Promise<Submitted> {
  if (deps.isCurrent && !deps.isCurrent()) throw new PaidSessionError('account-not-resolved')
  const now = deps.now ?? (() => performance.now())
  onStep?.({ phase: 'signing' })
  if (deps.isCurrent && !deps.isCurrent()) throw new PaidSessionError('account-not-resolved')
  const submittedAt = now()
  let callId: string
  try {
    callId = await deps.account.send(calls)
  } catch (err) {
    return { progress: null, sendError: err, submittedAt }
  }
  onStep?.({ phase: 'submitted', callId })
  const progress = await trackCall(deps.account, callId, deps.poll ?? {})
  return { progress, sendError: null, submittedAt }
}

async function receiptsOf(deps: PaidChainDeps, progress: CallProgress): Promise<ReceiptLike[]> {
  if (progress.state === 'pending') return []
  const out: ReceiptLike[] = []
  for (const hash of progress.transactionHashes) {
    const r = await deps.client.getTransactionReceipt({ hash })
    out.push({ status: r.status, blockHash: r.blockHash, blockNumber: r.blockNumber, logs: r.logs })
  }
  return out
}

function observe(deps: PaidChainDeps, timestampSec: number): void {
  const now = deps.now ?? (() => performance.now())
  const t = now()
  deps.clock?.observe({ timestampSec, sentMs: t, receivedMs: t, head: false })
}

export type OpenResult = { facts: PaidSessionFacts; hash: Hex | null; submittedAt: number }

const OPEN_ERRORS: Readonly<Record<string, PaidSessionErrorCode>> = {
  EntryPaused: 'entry-paused',
  InsufficientHouseLiquidity: 'house-liquidity',
  [SPONSOR_QUOTA_REASON]: 'sponsor-quota',
}

/**
 * 开场：智能账户以完整下注调用 payable `openSession`，Game 同笔转入 Vault。已有未完结会话时抛 `active-session`
 * （带 sessionId，界面去走恢复）；发送失败、回退或超时都先读 `sessionOf`，链上已开场就按链上事实返回。
 */
export async function openPaidSession(
  deps: PaidChainDeps, horseId: number, stake: bigint, onStep?: (s: PaidTxStep) => void,
  roster: readonly number[] = DEFAULT_ROSTER,
): Promise<OpenResult> {
  const player = requirePlayer(deps.account)
  paidTierForStake(stake)
  const existing = await readSessionOf(deps.client, deps.game, player)
  if (existing !== ZERO_HASH) throw new PaidSessionError('active-session', '', existing)
  const rules = await deps.client.readContract({ address: deps.game, abi: ponyGameAbi, functionName: 'rulesetHash' })
  if (rules.toLowerCase() !== PAID_RULESET_HASH.toLowerCase()) throw new PaidSessionError('ruleset-mismatch')
  const balance = await deps.client.getBalance({ address: player })
  if (balance < stake) throw new PaidSessionError('insufficient-wallet', `${stake}`)
  const calls = [openSessionCall(deps.game, horseId, stake, roster)]
  const { progress, sendError, submittedAt } = await submit(deps, calls, onStep)

  if (progress?.state === 'included') {
    for (const receipt of await receiptsOf(deps, progress)) {
      const facts = parseSessionOpened(receipt, deps.game, player)
      if (facts) {
        observe(deps, facts.openedAt)
        onStep?.({ phase: 'included', hash: lastHash(progress) })
        return { facts, hash: lastHash(progress), submittedAt }
      }
    }
  }
  // 不确定：链上说了算
  const now = await readSessionOf(deps.client, deps.game, player).catch(() => ZERO_HASH)
  if (now !== ZERO_HASH) {
    const facts = await readSessionFacts(deps.client, deps.game, now)
    observe(deps, facts.openedAt)
    onStep?.({ phase: 'included', hash: lastHash(progress) })
    return { facts, hash: lastHash(progress), submittedAt }
  }
  if (sendError !== null) {
    const reason = errorReason(sendError)
    onStep?.({ phase: 'failed', hash: null, reason })
    throw new PaidSessionError(OPEN_ERRORS[reason] ?? 'rejected', reason)
  }
  if (progress?.state === 'timeout') {
    onStep?.({ phase: 'unconfirmed', callId: progress.callId })
    throw new PaidSessionError('unconfirmed', progress.callId)
  }
  const hash = lastHash(progress)
  onStep?.({ phase: 'failed', hash, reason: 'reverted' })
  throw new PaidSessionError('reverted', hash ?? '')
}

export type ChoiceOutcome =
  | { state: 'included'; choice: PaidChoiceFact; hash: Hex | null; submittedAt: number }
  /** 没上链：发送前被拒（模拟失败）或链上回退；reason 尽量是 PonyGame 的错误名 */
  | { state: 'rejected'; reason: string; hash: Hex | null; submittedAt: number }
  /** 等满仍不知道，且链上也还没有这一检查点的记录 */
  | { state: 'unknown'; submittedAt: number }

/** 选牌或主动放弃（cardId 0）。成功时锚 = 该交易所在块的哈希。 */
export async function choosePaidCard(
  deps: PaidChainDeps, facts: PaidSessionFacts, checkpoint: 1 | 2 | 3, cardId: number, refreshSlots: readonly number[],
  onStep?: (s: PaidTxStep) => void,
): Promise<ChoiceOutcome> {
  requirePlayer(deps.account)
  const call = chooseCardCall(deps.game, facts.sessionId, checkpoint, cardId, refreshSlots)
  const { progress, sendError, submittedAt } = await submit(deps, [call], onStep)
  if (progress?.state === 'included') {
    for (const receipt of await receiptsOf(deps, progress)) {
      const choice = parseCardChosen(receipt, deps.game, facts.sessionId, checkpoint)
      if (choice) {
        observe(deps, facts.openedAt + choice.txSec)
        onStep?.({ phase: 'included', hash: lastHash(progress) })
        return { state: 'included', choice, hash: lastHash(progress), submittedAt }
      }
    }
  }
  const onChain = await readChoice(deps, facts.sessionId, checkpoint).catch(() => null)
  if (onChain) {
    observe(deps, facts.openedAt + onChain.txSec)
    const hash = lastHash(progress)
    onStep?.({ phase: 'included', hash })
    return { state: 'included', choice: onChain, hash, submittedAt }
  }
  if (sendError !== null) {
    const reason = errorReason(sendError)
    onStep?.({ phase: 'failed', hash: null, reason })
    return { state: 'rejected', reason, hash: null, submittedAt }
  }
  if (progress?.state === 'timeout') {
    onStep?.({ phase: 'unconfirmed', callId: progress.callId })
    return { state: 'unknown', submittedAt }
  }
  const hash = lastHash(progress)
  onStep?.({ phase: 'failed', hash, reason: 'reverted' })
  return { state: 'rejected', reason: 'reverted', hash, submittedAt }
}

/** 读链上该检查点的记录（含锚）；没有返回 null。 */
export async function readChoice(deps: Pick<PaidChainDeps, 'client' | 'game'>, sessionId: Hex, checkpoint: 1 | 2 | 3): Promise<PaidChoiceFact | null> {
  const view = await readSessionView(deps.client, deps.game, sessionId)
  const c = view.choices[checkpoint - 1]
  if (!c || !c.present) return null
  return choiceFact(checkpoint, c, c.anchor !== ZERO_HASH ? c.anchor : await blockHash(deps.client, c.blockNumber))
}

export type SettleOutcome =
  | { state: 'settled'; settlement: PaidSettlementFacts }
  | { state: 'failed'; reason: string; hash: Hex | null }
  | { state: 'unknown' }

/**
 * 结算：任何人都能调用，冲线之前合约报 RaceNotFinished。发送前先看会话是否已被结算（保管人或上一次
 * 重试可能已经结了），失败或超时后再看一次；已结算就从日志取 SessionSettled。
 */
export async function settlePaidSession(
  deps: PaidChainDeps, facts: Pick<PaidSessionFacts, 'sessionId' | 'openedBlock'>, onStep?: (s: PaidTxStep) => void,
): Promise<SettleOutcome> {
  const settledAlready = await settledFromChain(deps, facts)
  if (settledAlready) return settledAlready
  const { progress, sendError } = await submit(deps, [settleSessionCall(deps.game, facts.sessionId)], onStep)
  if (progress?.state === 'included') {
    for (const [i, receipt] of (await receiptsOf(deps, progress)).entries()) {
      const settlement = parseSessionSettled(
        receipt.logs, deps.game, facts.sessionId, progress.transactionHashes[i] ?? null, receipt.blockNumber,
      )
      if (settlement) {
        const confirmed = await settlementReward(deps.client, deps.game, settlement, receipt.logs)
        onStep?.({ phase: 'included', hash: settlement.hash })
        return { state: 'settled', settlement: confirmed }
      }
    }
  }
  const after = await settledFromChain(deps, facts)
  if (after) {
    if (after.state === 'settled') onStep?.({ phase: 'included', hash: after.settlement.hash })
    return after
  }
  if (sendError !== null) {
    const reason = errorReason(sendError)
    onStep?.({ phase: 'failed', hash: null, reason })
    return { state: 'failed', reason, hash: null }
  }
  if (progress?.state === 'timeout') {
    onStep?.({ phase: 'unconfirmed', callId: progress.callId })
    return { state: 'unknown' }
  }
  const hash = lastHash(progress)
  onStep?.({ phase: 'failed', hash, reason: 'reverted' })
  return { state: 'failed', reason: 'reverted', hash }
}

async function settledFromChain(
  deps: PaidChainDeps, facts: Pick<PaidSessionFacts, 'sessionId' | 'openedBlock'>,
): Promise<SettleOutcome | null> {
  const view = await readSessionView(deps.client, deps.game, facts.sessionId)
  if (view.state === SESSION_STATE.settled) {
    const settlement = await findSettlement(deps.client, deps.game, facts.sessionId, facts.openedBlock, deps.logChunk)
    return settlement ? { state: 'settled', settlement } : { state: 'failed', reason: 'SETTLED_EVENT_NOT_FOUND', hash: null }
  }
  if (view.state === SESSION_STATE.forfeited) return { state: 'failed', reason: 'FORFEITED', hash: null }
  return null
}
