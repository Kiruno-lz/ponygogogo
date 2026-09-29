/**
 * 有奖选牌窗口的纯规则：什么时候能发、什么时候停收、交易大概落在哪一秒、刷新预览换出哪张牌。
 * 时间一律用 wall 毫秒（以 T0·1000 为 0 的链上时间），链上时间是一个区间 [lo, hi]（chainClock.ts）。
 *
 * - 发送：只有确定已到 openSec（wallLo ≥ openSec·1000）才发，否则交易可能落在 openSec 之前的块里、按规则不生效
 *   （有奖规则 v3：链上照单全收，不合法的已存选择在结算时按无交易处理，所以浏览器必须自己守住窗口）。
 * - 停收：wallHi ≥ (openSec + 20)·1000 − marginMs 之后不再接受新点击。窗口末端不含：时间戳为 openSec+19 的
 *   最后一块是链上时间 (openSec+20)·1000 之前产出的块，所以交易必须在那之前入块；marginMs 就是留给入块的时间。
 * - 余量取值：Alchemy sma-b 受赞助调用在 Monad 测试网实测提交→入块 p50 1540 ms、p95 1902 ms；取 marginMs = 5000，
 *   即最后一次点击后仍有 5 s 入块，p95 之外还留约 3.1 s；本地开发链 anvil 0.5 s 出块，直接 EOA 入块通常 < 1 s，
 *   取 2000。停收判定用 hi，时钟误差已含在内。
 * - 预测：点击后按 txSec ≈ floor((发送时刻 + 入块时延)/1000) 乐观地关面板；时延先取上面的实测默认值，
 *   再用本场已入块交易的实测值（中位数）更新。回执到了一律以真实 txSec 重解。
 */
import type { PaidDrawState } from './core/paidDrawRules.ts'

export const CHOICE_WINDOW_MS = 20_000
/** 结算发送的余量：链上 (block.timestamp − T0)·1000 ≥ finishWall 才放行，时间戳是整秒 */
export const SETTLE_MARGIN_MS = 300

export type ChoiceTiming = {
  /** 提交→入块的预期时延（ms） */
  latencyMs: number
  /** 窗口末端之前停收新点击的余量（ms） */
  marginMs: number
}

/** Monad 测试网 + Alchemy sma-b（受赞助 sendCalls，实测入块 p50 1540 ms、p95 1902 ms；预测取略高于 p50） */
export const ALCHEMY_TIMING: ChoiceTiming = { latencyMs: 1600, marginMs: 5000 }
/** 本地 anvil（0.5 s 出块）+ 直接 EOA */
export const DEV_EOA_TIMING: ChoiceTiming = { latencyMs: 700, marginMs: 2000 }

export type WallRange = { lo: number; mid: number; hi: number }

export function windowEndWall(openSec: number): number {
  return openSec * 1000 + CHOICE_WINDOW_MS
}

export function acceptCutoffWall(openSec: number, marginMs: number): number {
  return windowEndWall(openSec) - marginMs
}

/** 确定已经过了 openSec：此刻发出的交易不会落进更早的块。 */
export function maySend(openSec: number, wall: WallRange): boolean {
  return wall.lo >= openSec * 1000
}

/** 仍接受新点击：即使时钟偏快（hi），截止前也还留着 marginMs 入块。 */
export function acceptsClick(openSec: number, wall: WallRange, marginMs: number): boolean {
  return wall.hi < acceptCutoffWall(openSec, marginMs)
}

/** 预测交易落块的秒（相对 T0），夹在合法窗口 [openSec, openSec + 19] 内。 */
export function predictTxSec(openSec: number, sendWall: number, latencyMs: number): number {
  const sec = Math.floor((sendWall + latencyMs) / 1000)
  return Math.min(openSec + 19, Math.max(openSec, sec))
}

/** 结算最早可发的 wall：finishWall 向上取整到秒，再加余量。 */
export function settleReadyWall(finishWall: number): number {
  return Math.ceil(finishWall / 1000) * 1000 + SETTLE_MARGIN_MS
}

/** 入块时延：默认值 + 本场实测样本的中位数；样本限定在 [100, 15000] ms 防止坏样本。 */
export class LatencyEstimator {
  private readonly samples: number[] = []
  constructor(private readonly initialMs: number, private readonly max = 9) {}

  sample(ms: number): void {
    if (!Number.isFinite(ms)) return
    this.samples.push(Math.min(15_000, Math.max(100, ms)))
    if (this.samples.length > this.max) this.samples.shift()
  }

  get value(): number {
    if (this.samples.length === 0) return this.initialMs
    const sorted = [...this.samples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]!
  }
}

export type RefreshPreview = {
  /** 刷新后的三张候选（cardId） */
  candidates: number[]
  /** 还剩几次刷新 */
  creditsLeft: number
  /** 槽位 i 还能不能刷新：有额度、本检查点没刷过、反向游标没追上正向游标 */
  canRefresh: [boolean, boolean, boolean]
}

/**
 * 本地刷新预览，与 applyPaidChoice 的规则逐条一致：每次刷新把该槽换成 deck[--tailCursor]，
 * 同一检查点每个槽最多一次，额度不足或反向游标追上正向游标（cursor + 3）即不可再刷。
 * 预览不上链；刷新随选牌交易的 refreshSlots 一起提交。
 */
export function refreshPreview(deck: readonly number[], draw: PaidDrawState, slots: readonly number[]): RefreshPreview {
  const candidates = deck.slice(draw.cursor, draw.cursor + 3)
  const nextCursor = draw.cursor + 3
  let tail = draw.tailCursor
  let used = 0
  for (const slot of slots) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 2 || (used & (1 << slot)) !== 0) throw new Error('INVALID_REFRESH')
    if (slots.length > draw.refreshCredits || tail <= nextCursor) throw new Error('NO_REFRESH_CREDIT')
    candidates[slot] = deck[--tail]!
    used |= 1 << slot
  }
  const creditsLeft = draw.refreshCredits - slots.length
  const free = creditsLeft > 0 && tail > nextCursor && !draw.automatic && !draw.forfeited
  return {
    candidates,
    creditsLeft,
    canRefresh: [0, 1, 2].map((slot) => free && (used & (1 << slot)) === 0) as [boolean, boolean, boolean],
  }
}
