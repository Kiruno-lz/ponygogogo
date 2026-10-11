import {
  decodeErrorResult,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient
} from 'viem'
import { type PonyRoster } from '../race/core/roster.ts'
import { isSponsorQuotaError, type CallAccount } from './alchemy.ts'
import type { ChainClock } from './chainClock.ts'
import { type TrackOptions } from './funds.ts'
import {
  ponyGameAbi
} from './paidCalls.ts'
import { type CollectibleGrant } from './rewards.ts'

export const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex

export type PaidTier = 1 | 2 | 3 | 4

export type PaidChoiceFact = {
  checkpoint: 1 | 2 | 3
  /** 0 = 主动放弃 */
  cardId: number
  refreshSlots: number[]
  /** block.timestamp − T0（秒） */
  txSec: number
  blockNumber: bigint
  /** 该块的哈希 */
  anchor: Hex
}

export type PaidChoiceFacts = [PaidChoiceFact | null, PaidChoiceFact | null, PaidChoiceFact | null]

export type PaidSessionFacts = {
  sessionId: Hex
  player: Address
  state: number
  horseId: number
  stakeTier: PaidTier
  stake: bigint
  seed: Hex
  /** T0，秒 */
  openedAt: number
  openedBlock: bigint
  openAnchor: Hex
  choices: PaidChoiceFacts
  /** Participant identities fixed at entry. */
  roster: PonyRoster
}

export type PaidSettlementFacts = {
  sessionId: Hex
  player: Address
  finishTime: number[]
  rawOrder: number[]
  settlementOrder: number[]
  rank: number
  payout: bigint
  digest: Hex
  /** 检查点 1..3 实际获得的卡（0 = 没有卡：超时、断卡、主动放弃或选择未生效） */
  acquired: number[]
  hash: Hex | null
  blockNumber: bigint | null
  /** Only the registered reward ledger's event in this settlement transaction.  */
  grant?: CollectibleGrant | null
  /** Missing reward information does not invalidate a confirmed payout. undefined grant means unread. */
  grantError?: string | null
}

/** 界面显示的交易阶段：已提交 / 已入块 / 失败 / 未确认（等满仍无结果）。 */
export type PaidTxStep =
  | { phase: 'signing' }
  | { phase: 'submitted'; callId: string }
  | { phase: 'included'; hash: Hex | null }
  | { phase: 'failed'; hash: Hex | null; reason: string }
  | { phase: 'unconfirmed'; callId: string }

export type PaidSessionErrorCode =
  | 'account-not-resolved'
  | 'active-session'
  | 'insufficient-wallet'
  | 'entry-paused'
  | 'rejected'
  | 'reverted'
  | 'unconfirmed'
  | 'missing-event'
  | 'not-open'
  /** Vault 的庄家流动性暂时付不起该档的最大赔付（InsufficientHouseLiquidity） */
  | 'house-liquidity'
  /** Alchemy 赞助策略的额度用完：重发只会再被拒 */
  | 'sponsor-quota'
  | 'ruleset-mismatch'

export class PaidSessionError extends Error {
  readonly code: PaidSessionErrorCode
  readonly detail: string
  readonly sessionId: Hex | null
  constructor(code: PaidSessionErrorCode, detail = '', sessionId: Hex | null = null) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'PaidSessionError'
    this.code = code
    this.detail = detail
    this.sessionId = sessionId
  }
}

/** 流程需要的读接口；viem PublicClient 满足，L1 注入替身。 */
export type SessionReader = Pick<PublicClient, 'readContract' | 'getTransactionReceipt' | 'getBlock' | 'getLogs' | 'getBalance'>

export type PaidChainDeps = {
  account: CallAccount
  client: SessionReader
  game: Address
  poll?: Omit<TrackOptions, 'onProgress'>
  /** 回执里的区块时间戳喂给时钟作下界；`now` 与时钟同一条本地时间轴 */
  clock?: ChainClock
  now?: () => number
  /** False after logout, account replacement, or abandoning the driver; checked immediately before send. */
  isCurrent?: () => boolean
  /** eth_getLogs 单次最多跨多少块（Monad 公共 RPC 有上限） */
  logChunk?: bigint
}

/**
 * openSession 里 Vault.lockStake 回退的错误会原样冒泡；这些不在 PonyGame 的 ABI 里（那份与 Foundry 产物逐项比对），
 * 单列出来只用于解码。
 */
export const vaultErrorAbi = parseAbi([
  'error InsufficientHouseLiquidity()',
  'error InvalidLock()',
  'error UnauthorizedGame()',
])

/** 失败原因里的规范码：赞助额度用完（不是合约错误，但同样不可重试） */
export const SPONSOR_QUOTA_REASON = 'SponsorQuotaExhausted'

export function decodeRevert(hex: Hex): string | null {
  for (const abi of [ponyGameAbi, vaultErrorAbi]) {
    try {
      return decodeErrorResult({ abi, data: hex }).errorName
    } catch {
      // 不是这份 ABI 的错误
    }
  }
  return null
}

/** viem 错误链里带的回退数据按 PonyGame 的错误表解码；解不出返回 null。 */
export function revertName(err: unknown): string | null {
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const data = (cur as { data?: unknown }).data
    const hex = typeof data === 'string' ? data : typeof (data as { data?: unknown })?.data === 'string'
      ? (data as { data: string }).data : null
    if (hex && /^0x[0-9a-fA-F]{8,}$/.test(hex)) {
      const name = decodeRevert(hex as Hex)
      if (name) return name
    }
    const named = (cur as { errorName?: unknown }).errorName ?? (cur as { data?: { errorName?: unknown } }).data?.errorName
    if (typeof named === 'string') return named
    cur = (cur as { cause?: unknown }).cause
  }
  const message = err instanceof Error ? err.message : String(err)
  const match = /\b(ActiveSession|AnchorUnavailable|EntryPaused|ForfeitNotAllowed|ForfeitProbeGasTooLow|ForfeitTooEarly|InsufficientHouseLiquidity|InvalidCard|InvalidCheckpoint|InvalidEntry|InvalidRefreshSlot|InvalidSolverResult|NotSessionPlayer|RaceNotFinished|SessionNotOpen|TooManyRefreshes|UnknownSession)\b/.exec(message)
  if (match) return match[1]!
  // 只把回退数据拼进文字的错误（Alchemy 的模拟失败）：逐个试其中的十六进制串
  for (const hex of message.match(/0x[0-9a-fA-F]{8,}/g) ?? []) {
    const name = decodeRevert(hex as Hex)
    if (name) return name
  }
  return null
}

/** 界面用的失败原因：优先 PonyGame 错误名，其次 RPC/viem 给的短说明，单行、至多 80 字符。 */
export function errorReason(err: unknown): string {
  if (isSponsorQuotaError(err)) return SPONSOR_QUOTA_REASON
  const named = revertName(err)
  if (named) return named
  const e = err as { details?: unknown; shortMessage?: unknown; message?: unknown } | null
  const text = typeof e?.details === 'string' && e.details ? e.details
    : typeof e?.shortMessage === 'string' && e.shortMessage ? e.shortMessage
      : typeof e?.message === 'string' ? e.message : String(err)
  return text.split('\n')[0]!.slice(0, 80)
}
