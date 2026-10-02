import type { DriverPhase } from './driver.ts'
import type { RaceEvent, RaceInput, RaceState } from './core/types.ts'

/**
 * RaceScreen / RaceScene / Hud 读取驱动器的全部接口。免费试玩的 `RaceDriver`（本地时钟上的共享求时器）与
 * 有奖的 `PaidRaceDriver`（链上规范时间线上的 P2 求时器轨迹）都实现它；表现层不知道自己在画哪一种。
 */
export interface RaceScreenDriver {
  readonly state: RaceState
  readonly phase: DriverPhase
  /** 起跑倒计时剩余（现实 ms） */
  readonly countdownLeft: number
  /** 选牌面板剩余（现实 ms）；< 0 表示没有在计时 */
  readonly choiceLeftMs: number
  readonly slowmo: boolean
  readonly choiceInteraction?: { locked: boolean; autoPick: number | null }
  /** 推进到本地时刻 nowMs（performance.now 轴），返回本帧的表现事件 */
  update(nowMs: number): RaceEvent[]
  input(i: RaceInput): void
  armChoiceDeadline(): void
}
