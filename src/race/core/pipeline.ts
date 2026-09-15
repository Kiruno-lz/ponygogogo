/**
 * 数值结算流水线。三种算子、固定阶段：
 *
 *   阶段 A   + Σ add                                 直接加算池
 *   阶段 B   × (1 + B1 + B2 + B3 + B4)               百分比加算，四个子池各自钳制
 *   阶段 C   × Π mul                                 逐实例连乘
 *   阶段 D   clamp(硬上下限)
 *
 * 同一阶段内的实例可交换，因此拿牌顺序不影响结果。
 * B2 永久留空：节奏走 f̂，不进速度乘区。
 */
import { B3_CLAMP } from './constants.ts'
import { FP, clamp, mulFx, type Fixed } from './fixed.ts'
import type { ModifierContribution, ModifierTarget } from './types.ts'

export interface Aggregated {
  add: Fixed
  b1: Fixed
  b2: Fixed
  b3: Fixed
  b4: Fixed
  mul: Fixed[]
}

export function emptyAgg(): Aggregated {
  return { add: 0, b1: 0, b2: 0, b3: 0, b4: 0, mul: [] }
}

/**
 * 收集某个 target 的贡献。调用方必须先按 (moduleId, instanceId) 排好序，
 * 因为阶段 C 的连乘带截断，顺序会影响末位。
 */
export function aggregate(contribs: ModifierContribution[], target: ModifierTarget): Aggregated {
  const agg = emptyAgg()
  for (const c of contribs) {
    if (c.target !== target) continue
    if (c.op === 'add') {
      agg.add += c.value
    } else if (c.op === 'padd') {
      const pool = c.pool ?? 'b1'
      agg[pool] += c.value
    } else {
      agg.mul.push(c.value)
    }
  }
  return agg
}

export function applyPipeline(base: Fixed, agg: Aggregated, lo: Fixed, hi: Fixed): Fixed {
  // 阶段 A
  let v = base + agg.add
  // 阶段 B：B3 单独钳制在 ±60%，B4 由环境卡自身声明（此处不再收紧）
  const b3 = clamp(agg.b3, -B3_CLAMP, B3_CLAMP)
  const factor = FP + agg.b1 + agg.b2 + b3 + agg.b4
  v = mulFx(v, factor)
  // 阶段 C
  for (const m of agg.mul) {
    v = mulFx(v, m)
  }
  // 阶段 D
  return clamp(v, lo, hi)
}

/** 稳定排序：模块 id 字典序，同模块内按 instanceId 升序 */
export function sortContribs(list: ModifierContribution[]): ModifierContribution[] {
  return [...list].sort((a, b) => {
    if (a.moduleId !== b.moduleId) return a.moduleId < b.moduleId ? -1 : 1
    return a.instanceId - b.instanceId
  })
}
