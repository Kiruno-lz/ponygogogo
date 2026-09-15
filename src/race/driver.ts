/**
 * 实时驱动器：用 performance.now 的相对经过时间推进规则内核。
 * 正常每 20ms 推进一步，慢放每 200ms 推进一步；选牌限时仍是现实 20 秒。
 * 渲染帧率只改变插值，不改变结果。
 */
import { CARD_CHOICE_LIMIT_MS, SLOWMO_DEN, SLOWMO_NUM, TICK_MS } from './core/constants.ts'
import { RaceEngine, type RaceConfig } from './core/engine.ts'
import { ALL_MODULES } from './modules/index.ts'
import type { RaceEvent, RaceInput } from './core/types.ts'

export interface DriverOptions {
  /** 起跑倒计时（现实毫秒），倒计时期间不推进 tick */
  countdownMs: number
  /** 尾场快放倍率 */
  tailSpeed: number
}

export const DEFAULT_DRIVER: DriverOptions = { countdownMs: 3000, tailSpeed: 6 }

/**
 * 仅供回归与调试：URL 上的 ?raceSpeed=N 把模拟时钟整体加速 N 倍。
 * 它只改变每 tick 对应的现实毫秒数，不改变 tick 序列本身，因此结果逐字段不变。
 */
function urlRaceSpeed(): number {
  if (typeof window === 'undefined') return 1
  const v = Number(new URLSearchParams(window.location.search).get('raceSpeed'))
  return Number.isFinite(v) && v >= 1 && v <= 40 ? v : 1
}

export type DriverPhase = 'countdown' | 'racing' | 'tail' | 'done'

export class RaceDriver {
  readonly engine: RaceEngine
  phase: DriverPhase = 'countdown'
  /** 倒计时剩余毫秒 */
  countdownLeft: number
  /** 选牌限时的现实剩余毫秒；<0 表示未武装 */
  choiceLeftMs = -1
  private acc = 0
  private lastNow = -1
  private queued: RaceInput[] = []
  private deadlineArmed = false
  private readonly speed: number

  constructor(
    cfg: RaceConfig,
    private readonly opts: DriverOptions = DEFAULT_DRIVER,
  ) {
    this.engine = new RaceEngine(cfg, ALL_MODULES)
    this.speed = urlRaceSpeed()
    this.countdownLeft = opts.countdownMs / this.speed
  }

  get state() {
    return this.engine.state
  }

  get slowmo(): boolean {
    return this.state.pending !== null
  }

  input(i: RaceInput): void {
    this.queued.push(i)
  }

  /** 卡牌进入可交互状态时由表现层调用，20 秒限时从这一刻起算 */
  armChoiceDeadline(): void {
    if (this.deadlineArmed) return
    this.deadlineArmed = true
    this.choiceLeftMs = CARD_CHOICE_LIMIT_MS
  }

  /** 推进到当前现实时刻，返回本次产生的表现事件 */
  update(nowMs: number): RaceEvent[] {
    if (this.lastNow < 0) this.lastNow = nowMs
    let dt = nowMs - this.lastNow
    this.lastNow = nowMs
    if (dt < 0) dt = 0
    if (dt > 250) dt = 250 // 掉帧保护：不追超过 250ms

    const events: RaceEvent[] = []

    if (this.phase === 'countdown') {
      this.countdownLeft -= dt
      if (this.countdownLeft <= 0) {
        this.countdownLeft = 0
        this.phase = 'racing'
      }
      return events
    }
    if (this.phase === 'done') return events

    // 选牌限时按现实时间走，不被慢放
    if (this.state.pending) {
      if (this.deadlineArmed) {
        this.choiceLeftMs -= dt
        if (this.choiceLeftMs <= 0) {
          this.choiceLeftMs = 0
          this.queued.push({ kind: 'timeout' })
        }
      }
    } else {
      this.deadlineArmed = false
      this.choiceLeftMs = -1
    }

    // 慢放段不跟随 raceSpeed 加速：选牌限时是现实 20 秒，加速它会改变面板与比赛的比例
    const perTick = this.slowmo
      ? (TICK_MS * SLOWMO_DEN) / SLOWMO_NUM
      : (this.phase === 'tail' ? TICK_MS / this.opts.tailSpeed : TICK_MS) / this.speed

    this.acc += dt
    let guard = 0
    while (this.acc >= perTick && !this.state.raceOver && guard < 400) {
      this.acc -= perTick
      guard++
      const frame = this.queued
      this.queued = []
      this.engine.step(frame)
      events.push(...this.state.events)
      if (this.state.playerFinished && this.phase === 'racing') this.phase = 'tail'
      if (this.state.pending) break // 面板一开就停下，让限时从可交互那刻起算
    }
    if (this.queued.length > 0 && this.state.pending) {
      // 面板开启期间的输入（pick / refresh / timeout）立即结算，不等下一 tick
      const frame = this.queued
      this.queued = []
      this.engine.step(frame)
      events.push(...this.state.events)
    }

    if (this.state.raceOver) this.phase = 'done'
    return events
  }
}
