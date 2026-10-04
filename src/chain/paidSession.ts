/**
 * 有奖会话的链上流程（会话协议 v2）：开场、选牌、结算、刷新恢复与结算期限。
 *
 * 每一步都经同一个 `CallAccount` 发出（运行时是 Alchemy sma-b，开发链与测试是直接 EOA），按
 * 调用 ID → 交易哈希 → 回执 的顺序等入块，再从回执日志里读 PonyGame 的事件：
 *
 * - 开场：`SessionOpened` 给 sessionId、seed、T0（openedAt）与 b₀（openedBlock）；开场锚取回执所在块的哈希。
 * - 选牌：`CardChosen` 给 txSec 与 blockNumber；该块的哈希就是这张卡的随机锚。合约只记录不判定，选择是否生效
 *   由结算求时决定（有奖规则 v3），浏览器在回执后用 `classifyPaidChoice` 判定（race/paidDriver.ts）。
 * - 结算：`SessionSettled` 给五马冲线时间、两层排序、玩家结算名次、返还、摘要与各检查点实际获得的卡——界面只信它。
 * - 判负：没有退款。所需锚过窗（8191 块）后任何人可 `forfeitSession`，返还 0；结算期限见 `readSettleDeadline`。
 *
 * **结果不确定时先读合约再决定**（docs/chain-and-economy.md §4）：发送抛错、回执回退或等满超时，一律先读
 * `sessionOf` / `getSession`，链上已经有了就按链上事实继续，绝不盲目重发第二笔。
 * 刷新恢复只依赖 `sessionOf(账户)` + `getSession` + 各块哈希（RPC），不依赖本地存储。
 */
import {
  decodeErrorResult,
  decodeEventLog,
  isAddressEqual,
  parseAbi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from 'viem'
import { isSponsorQuotaError, type CallAccount, type CallProgress } from './alchemy.ts'
import type { ChainClock } from './chainClock.ts'
import { trackCall, type TrackOptions } from './funds.ts'
import {
  chooseCardCall, openSessionCall, ponyGameAbi, SESSION_STATE, settleSessionCall,
} from './paidCalls.ts'
import { paidTierForStake } from './paidStakes.ts'
import { settleDeadline, type SettleDeadline } from './settleDeadline.ts'

const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex

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
  /** eth_getLogs 单次最多跨多少块（Monad 公共 RPC 有上限） */
  logChunk?: bigint
}

type ReceiptLike = { status: 'success' | 'reverted'; blockHash: Hex; blockNumber: bigint; logs: readonly Log[] }

// ---------------------------------------------------------------------------------------------- pure parsing

type OpenedArgs = {
  sessionId: Hex; player: Address; horseId: number; stake: bigint; seed: Hex; openedAt: bigint; openedBlock: bigint
}
type ChosenArgs = {
  sessionId: Hex; player: Address; checkpoint: number; cardId: number; refreshSlots: readonly number[]; txSec: number
  blockNumber: bigint
}
type SettledArgs = {
  sessionId: Hex; player: Address; finishTime: readonly number[]; rawOrder: readonly number[]
  settlementOrder: readonly number[]; playerSettlementRank: number; payout: bigint; digest: Hex
  acquired: readonly number[]
}

function gameEvents<T>(logs: readonly Log[], game: Address, eventName: string): T[] {
  const out: T[] = []
  for (const log of logs) {
    if (!isAddressEqual(log.address, game)) continue
    try {
      const decoded = decodeEventLog({ abi: ponyGameAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === eventName) out.push(decoded.args as T)
    } catch {
      // 同一笔批量交易里别的合约的日志
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
  }
}

/**
 * openSession 里 Vault.lockStake 回退的错误会原样冒泡；这些不在 PonyGame 的 ABI 里（那份与 Foundry 产物逐项比对），
 * 单列出来只用于解码。
 */
const vaultErrorAbi = parseAbi([
  'error InsufficientHouseLiquidity()',
  'error InvalidLock()',
  'error UnauthorizedGame()',
])

/** 失败原因里的规范码：赞助额度用完（不是合约错误，但同样不可重试） */
export const SPONSOR_QUOTA_REASON = 'SponsorQuotaExhausted'

function decodeRevert(hex: Hex): string | null {
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

// ---------------------------------------------------------------------------------------------- reads

type ChoiceView = {
  present: boolean; txSec: number; blockNumber: bigint; cardId: number; refreshSlots: readonly number[]; anchor: Hex
}
type SessionView = {
  player: Address; state: number; playerHorseId: number; stakeTier: number; stake: bigint; openedAt: bigint
  openedBlock: bigint; seed: Hex; openAnchor: Hex; lastCheckpoint: number; choices: readonly ChoiceView[]
}

export async function readSessionOf(client: SessionReader, game: Address, player: Address): Promise<Hex> {
  return await client.readContract({ address: game, abi: ponyGameAbi, functionName: 'sessionOf', args: [player] })
}

export async function readSessionView(client: SessionReader, game: Address, sessionId: Hex): Promise<SessionView> {
  return await client.readContract({
    address: game, abi: ponyGameAbi, functionName: 'getSession', args: [sessionId],
  }) as unknown as SessionView
}

async function blockHash(client: SessionReader, blockNumber: bigint): Promise<Hex> {
  const block = await client.getBlock({ blockNumber })
  if (!block.hash) throw new PaidSessionError('missing-event', `NO_BLOCK_HASH_${blockNumber}`)
  return block.hash
}

function choiceFact(k: number, view: ChoiceView, anchor: Hex): PaidChoiceFact {
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
    if (found) return found
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
  const now = deps.now ?? (() => performance.now())
  onStep?.({ phase: 'signing' })
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
): Promise<OpenResult> {
  const player = requirePlayer(deps.account)
  paidTierForStake(stake)
  const existing = await readSessionOf(deps.client, deps.game, player)
  if (existing !== ZERO_HASH) throw new PaidSessionError('active-session', '', existing)
  const balance = await deps.client.getBalance({ address: player })
  if (balance < stake) throw new PaidSessionError('insufficient-wallet', `${stake}`)
  const calls = [openSessionCall(deps.game, horseId, stake)]
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
  const settledAlready = await settledFromChain(deps, facts).catch(() => null)
  if (settledAlready) return settledAlready
  const { progress, sendError } = await submit(deps, [settleSessionCall(deps.game, facts.sessionId)], onStep)
  if (progress?.state === 'included') {
    for (const [i, receipt] of (await receiptsOf(deps, progress)).entries()) {
      const settlement = parseSessionSettled(
        receipt.logs, deps.game, facts.sessionId, progress.transactionHashes[i] ?? null, receipt.blockNumber,
      )
      if (settlement) {
        onStep?.({ phase: 'included', hash: settlement.hash })
        return { state: 'settled', settlement }
      }
    }
  }
  const after = await settledFromChain(deps, facts).catch(() => null)
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
