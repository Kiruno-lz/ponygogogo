/**
 * 有奖比赛的结果映射：求时器结果 → 结算页用的 RaceResult（预览），以及链上 SessionSettled 与
 * 浏览器求解的逐字段比对。付款口径只看链上；比对只用于提示「与预览不一致」和 E2E/L2 断言。
 */
import type { PaidSessionFacts, PaidSettlementFacts } from '../chain/paidSession.ts'
import type { ChoiceReason, RaceResult } from './core/types.ts'
import { solvePaidRace } from './paid/race.ts'
import type { PaidCheckpointReason, PaidChoiceSlots, PaidSolveOptions, PaidSolveResult } from './paid/solver.ts'
import { paidCardKey, tickOf } from './paidSnapshot.ts'

function choiceReason(reason: PaidCheckpointReason, cardId: number): ChoiceReason {
  if (cardId !== 0) return 'picked'
  if (reason === 'forfeit-tx') return 'forfeited'
  if (reason === 'timeout') return 'timeout'
  return 'not-reached'
}

/** 预览结果：名次取求时器的结算名次（含【版本答案】），完成时间是玩家的模拟冲线毫秒。 */
export function paidRaceResult(sessionId: string, seed: string, horseId: number, r: PaidSolveResult): RaceResult {
  return {
    raceId: sessionId,
    seed,
    horseId,
    rank: r.settlementRank as RaceResult['rank'],
    finishTick: tickOf(r.finishTime[horseId]!),
    choices: r.checkpoints.map((c, i) => ({
      checkpoint: i as 0 | 1 | 2,
      cardId: c.cardId !== 0 ? paidCardKey(c.cardId) : null,
      reason: choiceReason(c.reason, c.cardId),
      refreshes: [],
    })),
    gogoClicks: [],
    endReason: r.versionAnswer ? 'forced-combo' : 'finished',
  }
}

/** 没有卡的检查点在结算页上的说明键：断卡、玩家在面板期间冲线；其余沿用通用文案。 */
export function paidChoiceNoteKeys(r: PaidSolveResult): (string | null)[] {
  return r.checkpoints.map((c) => {
    if (c.cardId !== 0) return null
    if (c.reason === 'cut') return 'result.cut'
    if (c.reason === 'finished') return 'result.finishedInPanel'
    return null
  })
}

export type SettlementCheck = {
  /** 结算名次一致（任何求时器都必须成立） */
  rank: boolean
  /** 两层排序、五马冲线时间与各检查点实际获得的卡一致（真实求时器必须成立；替身求时器只保证名次） */
  full: boolean
}

export function compareSettlement(chain: PaidSettlementFacts, r: PaidSolveResult): SettlementCheck {
  const same = (a: readonly (number | bigint)[], b: readonly (number | bigint)[]) =>
    a.length === b.length && a.every((v, i) => BigInt(v) === BigInt(b[i]!))
  const rank = chain.rank === r.settlementRank
  const full = rank && same(chain.rawOrder, r.rawOrder) && same(chain.settlementOrder, r.settlementOrder)
    && same(chain.finishTime, r.finishTime) && same(chain.acquired, r.acquiredByCheckpoint)
  return { rank, full }
}

/**
 * 结算后结算页与分享图的三次选择以 `SessionSettled.acquired` 为准（每个检查点实际获得的卡，0 = 没有卡）。
 * 链上有卡就显示那张卡；链上没有而预览以为选中了（选择未生效），按超时显示；其余沿用预览的原因。
 */
export function settledChoices(choices: RaceResult['choices'], acquired: readonly number[]): RaceResult['choices'] {
  return choices.map((c, i) => {
    const card = acquired[i] ?? 0
    if (card !== 0) return { ...c, cardId: paidCardKey(card), reason: 'picked' }
    return { ...c, cardId: null, reason: c.reason === 'picked' ? 'timeout' : c.reason }
  })
}

/** 用链上事实（已上链的选择 + 块哈希锚）求完整比赛；未发生的检查点按超时。 */
export function solveFromFacts(facts: PaidSessionFacts, opts: PaidSolveOptions = { trace: false }): PaidSolveResult {
  return solvePaidRace({
    seed: facts.seed,
    openAnchor: facts.openAnchor,
    stakeTier: facts.stakeTier,
    playerHorseId: facts.horseId,
    choices: facts.choices.map((c) => (c
      ? { txSec: BigInt(c.txSec), cardId: c.cardId, refreshSlots: [...c.refreshSlots], anchor: c.anchor }
      : null)) as unknown as PaidChoiceSlots,
  }, opts)
}
