/**
 * 无头模拟驱动。规则内核可以在纯 Bun 环境里跑完整场比赛，
 * 因此批量回归不需要浏览器。
 */
import { ALL_MODULES } from '../modules/index.ts'
import { RaceEngine, type RaceConfig } from './engine.ts'
import type { RaceInput, RaceState } from './types.ts'

export interface SimPolicy {
  /** 每 N tick 点一次 gogo；0 表示全程不点 */
  clickEveryTicks: number
  /** 面板开启后等待多少 tick 再做决定 */
  decideAfterTicks: number
  /** 决定的方式 */
  decide: 'first' | 'last' | 'forfeit' | 'timeout'
  /** 面板开启时先刷新几次 */
  refreshes: number
}

export const POLICY_IDLE: SimPolicy = {
  clickEveryTicks: 0,
  decideAfterTicks: 10,
  decide: 'timeout',
  refreshes: 0,
}
export const POLICY_PERFECT: SimPolicy = {
  clickEveryTicks: 25,
  decideAfterTicks: 10,
  decide: 'first',
  refreshes: 0,
}
export const POLICY_MASH: SimPolicy = {
  clickEveryTicks: 6,
  decideAfterTicks: 10,
  decide: 'first',
  refreshes: 0,
}

export interface SimResult {
  engine: RaceEngine
  ticks: number
  inputs: Array<{ tick: number; input: RaceInput }>
}

export function runRace(
  cfg: RaceConfig,
  policy: SimPolicy = POLICY_PERFECT,
  maxTicks = 60000,
): SimResult {
  const engine = new RaceEngine(cfg, ALL_MODULES)
  const st: RaceState = engine.state
  const inputs: Array<{ tick: number; input: RaceInput }> = []
  let pendingOpenedAt = -1
  let refreshesDone = 0

  while (!st.raceOver && st.tick < maxTicks) {
    const frame: RaceInput[] = []

    if (st.pending) {
      if (pendingOpenedAt < 0) {
        pendingOpenedAt = st.tick
        refreshesDone = 0
      }
      const waited = st.tick - pendingOpenedAt
      if (refreshesDone < policy.refreshes && st.refreshCredits > 0 && waited >= 1) {
        frame.push({ kind: 'refresh', slot: refreshesDone % st.pending.candidates.length })
        refreshesDone++
      } else if (waited >= policy.decideAfterTicks) {
        const cands = st.pending.candidates
        if (policy.decide === 'timeout') frame.push({ kind: 'timeout' })
        else if (policy.decide === 'forfeit') frame.push({ kind: 'pick', cardId: null })
        else if (policy.decide === 'last') frame.push({ kind: 'pick', cardId: cands[cands.length - 1]! })
        else frame.push({ kind: 'pick', cardId: cands[0]! })
        pendingOpenedAt = -1
      }
    } else {
      pendingOpenedAt = -1
      if (
        policy.clickEveryTicks > 0 &&
        !st.playerFinished &&
        st.tick % policy.clickEveryTicks === 0
      ) {
        frame.push({ kind: 'gogoDown' })
      }
    }

    for (const i of frame) inputs.push({ tick: st.tick, input: i })
    engine.step(frame)
  }

  return { engine, ticks: st.tick, inputs }
}

/** 用记录下来的输入序列重放，用于确定性断言 */
export function replay(cfg: RaceConfig, inputs: Array<{ tick: number; input: RaceInput }>, maxTicks = 60000): RaceEngine {
  const engine = new RaceEngine(cfg, ALL_MODULES)
  const byTick = new Map<number, RaceInput[]>()
  for (const { tick, input } of inputs) {
    const list = byTick.get(tick) ?? []
    list.push(input)
    byTick.set(tick, list)
  }
  while (!engine.state.raceOver && engine.state.tick < maxTicks) {
    engine.step(byTick.get(engine.state.tick) ?? [])
  }
  return engine
}

/** 全场轨迹指纹，用于逐字段相等断言 */
export function traceFingerprint(engine: RaceEngine): string {
  return engine.state.horses
    .map(
      (h) =>
        [h.horseId, h.laneIndex, h.pos, h.dist, h.v, h.stamina, h.finishTick, h.finishOvershoot, h.rank].join(
          ',',
        ),
    )
    .join(';')
}
