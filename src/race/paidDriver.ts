/**
 * 有奖比赛驱动器：把链上已知的输入交给 P2 求时器（src/race/paid/），在链上规范时间线上逐帧取样，
 * 产出与免费试玩 `RaceDriver` 同形的快照（RaceScreenDriver），表现层照旧绘制。
 *
 * **时间映射**：每帧 本地时刻 → 链上时间区间（chainClock）→ wall = 链上时间 − T0·1000 → τ = tauAtWall。
 * 画面用的 displayWall 以限速方式追随 wall 的中点（落后时最多 3 倍速追赶、超前时最低 0.25 倍速等待，
 * 差距 > 5 s 直接跳到位），所以时钟估计每次微调都不会让马倒退或抖动；规则判定一律用链上区间本身。
 * 起跑倒计时是纯表现：倒计时期间画面停在 wall 0，结束后按上述速度追上规范时间。
 *
 * **求解**：已入块的选择按真实 txSec 与块哈希；尚未发生的检查点按超时处理，得到完整轨迹供预览。
 * 点击后先用 checkPaidChoice 按预测的 txSec 预检（链上不再拦迟到的点击，不合法的就不发），再乐观地关面板并重解；
 * 回执到了以真实 txSec/锚重解。**入块不等于生效**（有奖规则 v3）：回执后用 classifyPaidChoice 判定，
 * 不合法的已存选择按无交易处理（超时、自动或断卡照常由规则推导），面板不再开启并给出一条原因说明；
 * 回退只剩调用本身畸形一种情况，与未上链的选择一样按超时重解。
 * 每次重解都记录「旧轨迹在当前画面时刻的位置 − 新轨迹的位置」作为逐马偏移，在 correctionMs 内线性衰减到 0，
 * 画面平滑追到新轨迹（偏移 > 4000 单位视为真实跳变，直接交给场景瞬移）。规则结果永远只取重解后的轨迹。
 *
 * **选牌窗口**（paidWindow.ts）：面板在 openWall 出现；点击早于 openSec 时排队，确定过了 openSec 才发；
 * 链上时间上界越过 openSec + 20 − marginMs 后不再接受点击，面板显示已截止直到规范关闭。
 * C-04 自动面板只展示将被自动选中的卡、不收输入；C-03 断卡不开面板，只提示本检查点已断卡。
 * gogo 只产生镜头/音效事件，不进入求时器。
 */
import type { Hex } from 'viem'
import type { ClockEstimate } from '../chain/chainClock.ts'
import type { ChoiceOutcome, PaidSessionFacts, PaidTxStep } from '../chain/paidSession.ts'
import type { PaidChoiceInvalidReason } from './paid/events.ts'
import { derivePaidCoreInput } from './paid/race.ts'
import {
  checkPaidChoice, classifyPaidChoice, solvePaidCore, type PaidCheckpointRecord, type PaidChoiceSlot, type PaidChoiceSlots,
  type PaidCoreInput, type PaidSolveResult,
} from './paid/solver.ts'
import { sampleHorse, tauAtWall, type PaidTrace } from './paid/trace.ts'
import type { PaidDrawState } from './core/paidDrawRules.ts'
import type { RaceEvent, RaceInput, RaceState } from './core/types.ts'
import type { DriverPhase } from './driver.ts'
import {
  acceptCutoffWall, acceptsClick, LatencyEstimator, maySend, predictTxSec, refreshPreview,
  type ChoiceTiming, type WallRange,
} from './paidWindow.ts'
import {
  buildPaidSnapshot, demoPos, eventsUpTo, idlePaidState, paidCardNumber, tickOf, toRaceEvent, type PaidPanelView,
} from './paidSnapshot.ts'
import type { RaceScreenDriver } from './raceView.ts'

const PLACEHOLDER_ANCHOR: Hex = `0x${'00'.repeat(32)}`
const SNAP_MS = 5000
const MAX_OFFSET_UNITS = 4000 * 10_000
const CUT_NOTICE_MS = 2500

/** included = 已入块且生效；ignored = 已入块但按规则不生效（reason 为 CHOICE_INVALID 原因） */
export type PaidChoiceStatus = 'queued' | 'sending' | 'submitted' | 'included' | 'ignored' | 'rejected' | 'unknown'

/** 被忽略的选择之后，该检查点实际按什么处理 */
export type IgnoredChoiceOutcome = 'timeout' | 'auto' | 'cut' | 'none'

export type PaidChoiceView = {
  checkpoint: 1 | 2 | 3
  cardId: number
  status: PaidChoiceStatus
  hash: Hex | null
  /** rejected：失败原因（错误名或预检码）；ignored：PaidChoiceInvalidReason */
  reason: string | null
  /** 只在 ignored 时非空 */
  outcome: IgnoredChoiceOutcome | null
}

/** 规范求解里该检查点的去向：超时、自动选定或断卡；其余（冲线关闭、未到达）不计入。 */
export function ignoredChoiceOutcome(rec: PaidCheckpointRecord): IgnoredChoiceOutcome {
  if (rec.reason === 'timeout' || rec.reason === 'auto' || rec.reason === 'cut') return rec.reason
  return 'none'
}

/** RaceScreen 在有奖比赛里额外显示的状态 */
export type PaidOverlay = {
  entry: PaidTxStep | null
  choice: PaidChoiceView | null
  /** 刚刚经过的断卡检查点 */
  cut: 1 | 2 | 3 | null
  /** 当前面板已截止（不再接受点击），慢放仍按规范时间继续 */
  locked: boolean
  /** 自动面板里将被选中的是第几张 */
  autoPick: number | null
  /** 时钟误差界（ms），调试与 E2E 读 */
  clockErrorMs: number
}

export type PaidPreview = {
  rawRank: number
  settlementRank: number
  finishTime: bigint
  finishWall: bigint
  result: PaidSolveResult
}

export type SubmitChoice = (
  checkpoint: 1 | 2 | 3, cardId: number, refreshSlots: number[], onStep: (s: PaidTxStep) => void,
) => Promise<ChoiceOutcome>

export type PaidDriverOptions = {
  playerHorseId: number
  stakeTier: 1 | 2 | 3 | 4
  clock: { estimate(localMs: number): ClockEstimate }
  timing: ChoiceTiming
  submitChoice: SubmitChoice
  /** 纯视觉的起跑倒计时（ms），从驱动器第一次 update 起算；恢复进场时跳过 */
  countdownMs?: number
  /** 重解后的位置偏移衰减时长（ms） */
  correctionMs?: number
}

type Optimistic = {
  k: 1 | 2 | 3
  cardId: number
  refreshSlots: number[]
  status: 'queued' | 'sent'
  sentWall: number
  txSec: number | null
}

type PanelInfo = { k: 1 | 2 | 3; mode: 'manual' | 'auto'; openSec: number; openTau: bigint; draw: PaidDrawState; base: number[] }

export class PaidRaceDriver implements RaceScreenDriver {
  phase: DriverPhase = 'countdown'
  countdownLeft: number
  choiceLeftMs = -1

  private readonly opts: Required<Omit<PaidDriverOptions, 'submitChoice' | 'clock' | 'timing'>> & PaidDriverOptions
  private readonly latency: LatencyEstimator
  private facts: PaidSessionFacts | null = null
  private core: PaidCoreInput | null = null
  private confirmed: (PaidChoiceSlot | null)[] = [null, null, null]
  private optimistic: Optimistic | null = null
  private refresh: { k: number; slots: number[] } | null = null
  private solved: PaidSolveResult | null = null
  private trace: PaidTrace | null = null
  private panelCache = new Map<string, PanelInfo | null>()
  private displayWall = 0
  private displayTau = 0n
  private lastLocal = -1
  private countdownEnd: number | null = null
  private replayFloor = 0n
  private readonly emitted = new Set<string>()
  private offsets = [0, 0, 0, 0, 0]
  private offsetStart = 0
  private queued: RaceEvent[] = []
  private wall: WallRange = { lo: 0, mid: 0, hi: 0 }
  private clockError = 0
  private snapshot: RaceState
  private slow = false
  private panel: PaidPanelView | null = null
  private panelInfo: PanelInfo | null = null
  private entryStep: PaidTxStep | null = null
  private choiceView: PaidChoiceView | null = null
  private cutK: 1 | 2 | 3 | null = null
  private locked = false
  private autoPick: number | null = null
  private entryFailed = false

  constructor(opts: PaidDriverOptions) {
    this.opts = { countdownMs: 3000, correctionMs: 700, ...opts }
    this.latency = new LatencyEstimator(opts.timing.latencyMs)
    this.countdownLeft = this.opts.countdownMs
    this.snapshot = idlePaidState(opts.playerHorseId, opts.stakeTier)
  }

  // ------------------------------------------------------------------------------------------ public

  get state(): RaceState {
    return this.snapshot
  }

  get choiceInteraction() { return { locked: this.locked, autoPick: this.autoPick } }

  get slowmo(): boolean {
    return this.slow
  }

  get sessionFacts(): PaidSessionFacts | null {
    return this.facts
  }

  get overlay(): PaidOverlay {
    return {
      entry: this.entryStep, choice: this.choiceView, cut: this.cutK, locked: this.locked, autoPick: this.autoPick,
      clockErrorMs: this.clockError,
    }
  }

  get entryFailedState(): boolean {
    return this.entryFailed
  }

  /** 入场交易的阶段（签名 / 已提交 / 已入块 / 失败） */
  setEntryStep(step: PaidTxStep): void {
    this.entryStep = step
    if (step.phase === 'failed') this.entryFailed = true
  }

  failEntry(reason: string): void {
    this.entryStep = { phase: 'failed', hash: null, reason }
    this.entryFailed = true
  }

  /** 开场入块（或刷新恢复）后调用；resume 跳过倒计时、直接落到当前规范时刻，不回放已过去的事件。 */
  open(facts: PaidSessionFacts, opts: { resume?: boolean } = {}): void {
    if (facts.horseId !== this.opts.playerHorseId || facts.stakeTier !== this.opts.stakeTier) throw new Error('PAID_DRIVER_MISMATCH')
    this.facts = facts
    this.core = derivePaidCoreInput({
      seed: facts.seed, openAnchor: facts.openAnchor, stakeTier: facts.stakeTier, playerHorseId: facts.horseId,
      choices: [null, null, null],
    })
    this.confirmed = facts.choices.map((c) => (c ? slotOf(c) : null))
    this.resolve(false)
    if (opts.resume) {
      this.countdownEnd = -Infinity
      this.countdownLeft = 0
      this.pendingResume = true
    }
  }

  /** 用链上最新事实校正（恢复、未确认的选择、结算前的核对）。 */
  reconcile(facts: PaidSessionFacts): void {
    if (!this.facts || facts.sessionId !== this.facts.sessionId) return
    this.facts = facts
    this.confirmed = facts.choices.map((c) => (c ? slotOf(c) : null))
    if (this.optimistic && this.confirmed[this.optimistic.k - 1]) this.optimistic = null
    this.resolve(true)
  }

  /** 当前已知输入下的比赛结果（未发生的检查点按超时）；未开场为 null。 */
  preview(): PaidPreview | null {
    const r = this.solved
    if (!r || !this.facts) return null
    const h = this.facts.horseId
    return { rawRank: r.rawRank, settlementRank: r.settlementRank, finishTime: r.finishTime[h]!, finishWall: r.finishWall[h]!, result: r }
  }

  /** 只用已上链选择的完整求解：结算比对用它，不含乐观预测。 */
  canonicalResult(): PaidSolveResult | null {
    if (!this.core) return null
    return solvePaidCore({ ...this.core, choices: this.confirmed as unknown as PaidChoiceSlots }, { trace: false })
  }

  get playerFinishWall(): number | null {
    const p = this.preview()
    return p ? Number(p.finishWall) : null
  }

  /** 当前链上 wall 区间（ms，相对 T0） */
  get chainWall(): WallRange {
    return this.wall
  }

  armChoiceDeadline(): void {
    // 有奖面板的截止由链上规范时间决定，与动画无关
  }

  input(i: RaceInput): void {
    if (i.kind === 'gogoDown') {
      this.queued.push({ type: 'gogo', quality: 'good', tick: this.snapshot.tick })
      return
    }
    const info = this.panelInfo
    if (!info || info.mode !== 'manual' || this.locked || this.panel === null) return
    if (i.kind === 'refresh') {
      const slots = this.refresh?.k === info.k ? this.refresh.slots : []
      const view = refreshPreview(this.core!.playerDeck, info.draw, slots)
      if (!view.canRefresh[i.slot]) return
      this.refresh = { k: info.k, slots: [...slots, i.slot] }
      return
    }
    if (i.kind !== 'pick') return
    const cardId = i.cardId === null ? 0 : paidCardNumber(i.cardId)
    const refreshed = this.refresh?.k === info.k ? this.refresh.slots : []
    // 与同一帧里的刷新一致：按当前刷新预览校验，而不是上一帧快照里的候选
    const offer = refreshPreview(this.core!.playerDeck, info.draw, refreshed).candidates
    if (cardId === null || (cardId !== 0 && !offer.includes(cardId))) return
    const slots = cardId === 0 ? [] : [...refreshed]
    this.optimistic = { k: info.k, cardId, refreshSlots: slots, status: 'queued', sentWall: 0, txSec: null }
    this.choiceView = { checkpoint: info.k, cardId, status: 'queued', hash: null, reason: null, outcome: null }
    if (maySend(info.openSec, this.wall)) this.send(info)
  }

  update(nowMs: number): RaceEvent[] {
    if (this.lastLocal < 0) this.lastLocal = nowMs
    if (this.countdownEnd === null) this.countdownEnd = nowMs + this.opts.countdownMs
    const dt = Math.min(250, Math.max(0, nowMs - this.lastLocal))
    this.lastLocal = nowMs
    const out = this.queued
    this.queued = []
    this.countdownLeft = Math.max(0, this.countdownEnd - nowMs)
    if (!this.facts || !this.trace || !this.solved) {
      // 入场交易未入块：倒计时停在最后一秒，等链上 T0
      this.phase = 'countdown'
      this.countdownLeft = Math.max(this.countdownLeft, this.entryFailed ? 0 : 1000)
      return out
    }
    const est = this.opts.clock.estimate(nowMs)
    const t0 = this.facts.openedAt * 1000
    this.wall = { lo: est.lo - t0, mid: est.mid - t0, hi: est.hi - t0 }
    this.clockError = est.errorMs

    const counting = this.countdownLeft > 0
    const target = Math.max(0, this.wall.mid)
    if (this.pendingResume) {
      this.pendingResume = false
      this.displayWall = target
      this.replayFloor = BigInt(Math.floor(target))
    } else if (counting) {
      // 倒计时只是表现：画面停在起跑线，倒计时结束后再追上规范时间
      this.displayWall = 0
    } else {
      this.advanceDisplay(target, dt)
    }
    const wallInt = BigInt(Math.floor(this.displayWall))
    this.displayTau = tauAtWall(this.trace, wallInt)
    this.slow = isSlow(this.trace, wallInt)

    this.updatePanel(wallInt)
    if (this.optimistic?.status === 'queued' && this.panelInfoFor(this.optimistic.k) !== null) {
      const info = this.panelInfoFor(this.optimistic.k)!
      if (maySend(info.openSec, this.wall)) this.send(info)
    }
    this.updateCut(wallInt)

    const finishTime = this.solved.finishTime
    for (const e of eventsUpTo(this.trace.events, wallInt, this.emitted, this.replayFloor)) {
      const ev = toRaceEvent(e, this.trace, this.opts.playerHorseId, finishTime)
      if (ev) out.push(ev)
    }

    const raceOver = this.displayTau >= this.trace.tauEnd
    this.snapshot = buildPaidSnapshot({
      trace: this.trace, tau: this.displayTau, playerHorseId: this.opts.playerHorseId, stakeTier: this.opts.stakeTier,
      seed: this.facts.seed, posOffset: this.currentOffsets(nowMs), panel: this.panel, draw: this.panelInfo?.draw ?? null,
      playerDeck: this.core!.playerDeck, finishTime, raceOver, versionAnswer: this.solved.versionAnswer,
    })
    this.phase = counting ? 'countdown' : raceOver ? 'done' : this.snapshot.playerFinished ? 'tail' : 'racing'
    return out
  }

  // ------------------------------------------------------------------------------------------ internals

  private pendingResume = false

  /**
   * 画面时刻按现实时间前进，再以约 200 ms 的时间常数向链上中点收敛；收敛速度夹在 [0.25×, 3×] 之间，
   * 所以既不倒退也不瞬移。差距超过 SNAP_MS（切后台回来、时钟大幅重估）才直接跳到位。
   */
  private advanceDisplay(target: number, dt: number): void {
    const predicted = this.displayWall + dt
    const err = target - predicted
    if (Math.abs(err) > SNAP_MS) {
      this.displayWall = target
      this.replayFloor = BigInt(Math.floor(target - 1500))
      return
    }
    const step = err * Math.min(1, dt / 200)
    this.displayWall = Math.max(0, predicted + Math.min(2 * dt, Math.max(-0.75 * dt, step)))
  }

  private currentOffsets(nowMs: number): number[] {
    const p = this.opts.correctionMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - this.offsetStart) / this.opts.correctionMs))
    return this.offsets.map((o) => o * (1 - p))
  }

  private choices(): PaidChoiceSlots {
    const out = [...this.confirmed]
    const o = this.optimistic
    if (o && o.status === 'sent' && o.txSec !== null && out[o.k - 1] === null) {
      out[o.k - 1] = { txSec: BigInt(o.txSec), cardId: o.cardId, refreshSlots: o.refreshSlots, anchor: PLACEHOLDER_ANCHOR }
    }
    return out as unknown as PaidChoiceSlots
  }

  /** 以当前输入重解；correct = 记录旧→新的画面偏移做平滑校正 */
  private resolve(correct: boolean): void {
    const core = this.core!
    let next: PaidSolveResult
    try {
      next = solvePaidCore({ ...core, choices: this.choices() })
    } catch {
      // v3 求时器不会因不合法的选择抛错，只剩畸形输入；防御性地退回只用已上链的输入
      this.optimistic = null
      next = solvePaidCore({ ...core, choices: this.confirmed as unknown as PaidChoiceSlots })
    }
    const prev = this.trace
    if (correct && prev && next.trace) {
      const now = this.currentOffsets(this.lastLocal)
      const newTau = tauAtWall(next.trace, BigInt(Math.floor(this.displayWall)))
      this.offsets = [0, 1, 2, 3, 4].map((h) => {
        const before = demoPos(sampleHorse(prev, h, this.displayTau).pos) + now[h]!
        const after = demoPos(sampleHorse(next.trace!, h, newTau).pos)
        const d = before - after
        return Math.abs(d) < MAX_OFFSET_UNITS ? d : 0
      })
      this.offsetStart = this.lastLocal
    }
    this.solved = next
    this.trace = next.trace
  }

  /** 第 k 检查点面板开启时的发牌状态与基础候选；依赖于 k 之前已上链的选择，按其缓存 */
  private panelInfoFor(k: 1 | 2 | 3): PanelInfo | null {
    const key = `${k}:${JSON.stringify(this.confirmed.slice(0, k - 1), (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`
    if (this.panelCache.has(key)) return this.panelCache.get(key)!
    const earlier = [...this.confirmed.slice(0, k - 1), null, null, null].slice(0, 3) as unknown as PaidChoiceSlots
    let info: PanelInfo | null = null
    try {
      const stop = solvePaidCore({ ...this.core!, choices: earlier }, { stopAtPanel: k, trace: false })
      if (stop.panel && stop.panel.mode !== 'cut' && stop.status === 'panel') {
        info = {
          k, mode: stop.panel.mode, openSec: Number(stop.panel.openSec), openTau: stop.panel.openTau,
          draw: stop.panel.drawState, base: [...stop.panel.candidates],
        }
      }
    } catch {
      info = null
    }
    this.panelCache.set(key, info)
    return info
  }

  private updatePanel(wall: bigint): void {
    this.panel = null
    this.panelInfo = null
    this.locked = false
    this.autoPick = null
    this.choiceLeftMs = -1
    const r = this.solved!
    for (const rec of r.checkpoints) {
      if (!rec.reached || (rec.mode !== 'manual' && rec.mode !== 'auto')) continue
      if (wall < rec.openWall || wall >= rec.closeWall) continue
      const k = rec.checkpoint as 1 | 2 | 3
      if (rec.mode === 'manual' && (this.confirmed[k - 1] !== null || this.optimistic?.k === k)) return
      const info = this.panelInfoFor(k)
      if (!info) return
      this.panelInfo = info
      if (info.mode === 'auto') {
        this.panel = {
          checkpoint: k, mode: 'auto', candidates: info.base, refreshSlots: [], refreshCredits: 0, openTau: info.openTau,
        }
        this.autoPick = rec.cardId !== 0 ? info.base.indexOf(rec.cardId) : null
        this.choiceLeftMs = Math.max(0, Number(rec.closeWall) - this.wall.mid)
        return
      }
      const slots = this.refresh?.k === k ? this.refresh.slots : []
      const view = refreshPreview(this.core!.playerDeck, info.draw, slots)
      this.panel = {
        checkpoint: k, mode: 'manual', candidates: view.candidates, refreshSlots: [...slots],
        refreshCredits: view.canRefresh.some(Boolean) ? view.creditsLeft : 0, openTau: info.openTau,
      }
      this.locked = !acceptsClick(info.openSec, this.wall, this.opts.timing.marginMs)
      this.choiceLeftMs = Math.max(0, acceptCutoffWall(info.openSec, this.opts.timing.marginMs) - this.wall.mid)
      return
    }
  }

  private updateCut(wall: bigint): void {
    this.cutK = null
    for (const rec of this.solved!.checkpoints) {
      if (rec.mode === 'cut' && wall >= rec.openWall && wall < rec.openWall + BigInt(CUT_NOTICE_MS)) {
        this.cutK = rec.checkpoint as 1 | 2 | 3
      }
    }
  }

  private send(info: PanelInfo): void {
    const o = this.optimistic
    if (!o || o.status !== 'queued' || o.k !== info.k) return
    const txSec = predictTxSec(info.openSec, this.wall.mid, this.latency.value)
    // 链上只做形状检查、照单全收：按预测的落块秒预检，注定不生效的选择不发（例如落在玩家冲线之后）
    const guard = this.precheck(o, txSec)
    if (guard !== null) {
      this.optimistic = null
      this.choiceView = { checkpoint: o.k, cardId: o.cardId, status: 'rejected', hash: null, reason: guard, outcome: null }
      return
    }
    o.status = 'sent'
    o.sentWall = this.wall.mid
    o.txSec = txSec
    this.resolve(true)
    this.choiceView = { checkpoint: o.k, cardId: o.cardId, status: 'sending', hash: null, reason: null, outcome: null }
    const onStep = (s: PaidTxStep): void => {
      if (this.optimistic !== o || !this.choiceView) return
      if (s.phase === 'submitted') this.choiceView = { ...this.choiceView, status: 'submitted' }
    }
    this.opts.submitChoice(o.k, o.cardId, o.refreshSlots, onStep).then(
      (outcome) => this.onOutcome(o, outcome),
      (err: unknown) => this.onOutcome(o, { state: 'rejected', reason: err instanceof Error ? err.message : String(err), hash: null, submittedAt: 0 }),
    )
  }

  /** checkPaidChoice 的错误码；可以发时为 null */
  private precheck(o: Optimistic, txSec: number): string | null {
    const choices = [...this.confirmed]
    choices[o.k - 1] = { txSec: BigInt(txSec), cardId: o.cardId, refreshSlots: o.refreshSlots, anchor: PLACEHOLDER_ANCHOR }
    try {
      checkPaidChoice({ ...this.core!, choices: choices as unknown as PaidChoiceSlots }, o.k)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  private onOutcome(o: Optimistic, outcome: ChoiceOutcome): void {
    if (this.optimistic !== o) return
    this.optimistic = null
    if (outcome.state !== 'included') {
      this.choiceView = {
        checkpoint: o.k, cardId: o.cardId, status: outcome.state === 'unknown' ? 'unknown' : 'rejected',
        hash: outcome.state === 'rejected' ? outcome.hash : null, reason: outcome.state === 'rejected' ? outcome.reason : null,
        outcome: null,
      }
      this.resolve(true)
      return
    }
    const c = outcome.choice
    this.confirmed[o.k - 1] = slotOf(c)
    this.latency.sample(c.txSec * 1000 + 500 - o.sentWall)
    if (this.facts) {
      const choices = [...this.facts.choices] as PaidSessionFacts['choices']
      choices[o.k - 1] = c
      this.facts = { ...this.facts, choices }
    }
    this.resolve(true)
    // 已存即终局（lastCheckpoint 已前进，本检查点不能再发）；不生效时该检查点按规范求解的去向渲染
    const verdict = classifyPaidChoice({ ...this.core!, choices: this.confirmed as unknown as PaidChoiceSlots }, o.k)
    this.choiceView = verdict.valid
      ? { checkpoint: o.k, cardId: c.cardId, status: 'included', hash: outcome.hash, reason: null, outcome: null }
      : {
          checkpoint: o.k, cardId: c.cardId, status: 'ignored', hash: outcome.hash,
          reason: verdict.reason satisfies PaidChoiceInvalidReason,
          outcome: ignoredChoiceOutcome(this.solved!.checkpoints[o.k - 1]!),
        }
  }

  /** 测试钩子：当前画面时刻 */
  get debugDisplay(): { wall: number; tau: bigint; tick: number } {
    return { wall: this.displayWall, tau: this.displayTau, tick: tickOf(this.displayTau) }
  }
}

function slotOf(c: { txSec: number; cardId: number; refreshSlots: readonly number[]; anchor: Hex }): PaidChoiceSlot {
  return { txSec: BigInt(c.txSec), cardId: c.cardId, refreshSlots: [...c.refreshSlots], anchor: c.anchor }
}

function isSlow(trace: PaidTrace, wall: bigint): boolean {
  let slow = false
  for (const seg of trace.segments) {
    if (seg.wall > wall) break
    slow = seg.slow
  }
  return slow
}
