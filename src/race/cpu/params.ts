/**
 * 电脑马性格参数派生。
 *
 * seed 派生的是【四组】参数，不是五组：玩家那匹马的速度由输入决定。
 * 四组按玩家选马后剩余 horseId 升序依次分配，因此换一匹马只换外观、不换对手。
 *
 * 难度的唯一来源是下注金额，作用对象是 (base_i, max_i, ease_i) 这一组，三者同向移动。
 */
import { fx, mulFx, type Fixed } from '../core/fixed.ts'
import { hUnit } from '../core/rng.ts'
import type { CpuParams } from '../core/types.ts'

interface Range {
  lo: Fixed
  hi: Fixed
}

interface TierProfile {
  base: Range
  max: Range
  ease: Range
}

/** 下注档位 -> (base, max, ease) 分布。三者必须同向移动：只抬 max 是拧错了旋钮 */
const TIERS: TierProfile[] = [
  // 响应带由实测锚定（scripts/measure-pace.ts）：放任配速 ≈ 24.6，完美操作 + 拿卡 ≈ 35.2。
  // base_i 落在这条带子里的马才会响应玩家操作，因此各档位的 base 分布都压在带内。
  // 0 MON：纯教学局，稳、好赢
  { base: { lo: fx(21), hi: fx(27) }, max: { lo: fx(32), hi: fx(38) }, ease: { lo: fx(0.1), hi: fx(0.25) } },
  { base: { lo: fx(24), hi: fx(30) }, max: { lo: fx(35), hi: fx(42) }, ease: { lo: fx(0.07), hi: fx(0.18) } },
  { base: { lo: fx(26), hi: fx(32) }, max: { lo: fx(38), hi: fx(46) }, ease: { lo: fx(0.04), hi: fx(0.12) } },
  { base: { lo: fx(28), hi: fx(34) }, max: { lo: fx(41), hi: fx(50) }, ease: { lo: fx(0), hi: fx(0.07) } },
]

const MIN_RANGE: Range = { lo: fx(12), hi: fx(18) }
const GAIN_RANGE: Range = { lo: fx(0.004), hi: fx(0.02) }
/** 容忍带，单位为距离单位（不是定点的距离），下面会乘 FP */
const SLACK_RANGE: Range = { lo: fx(400), hi: fx(1800) }
const AMP_RANGE: Range = { lo: fx(0.3), hi: fx(1.5) }
const TAU_RANGE: Range = { lo: fx(15), hi: fx(60) }

function sample(seed: string, domain: string, args: number[], r: Range): Fixed {
  const u = hUnit(seed, domain, ...args)
  return r.lo + mulFx(r.hi - r.lo, u)
}

/**
 * 派生四组性格参数。索引 j ∈ [0,4) 与玩家选了哪匹马无关。
 * stakeTier ∈ [0, 4)
 */
export function deriveCpuParamSets(seed: string, stakeTier: number): CpuParams[] {
  const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, stakeTier))]!
  const out: CpuParams[] = []
  for (let j = 0; j < 4; j++) {
    const base = sample(seed, 'cpu.base', [j], tier.base)
    const max = sample(seed, 'cpu.max', [j], tier.max)
    const min = sample(seed, 'cpu.min', [j], MIN_RANGE)
    const gain = sample(seed, 'cpu.gain', [j], GAIN_RANGE)
    // slack 以距离单位给出，转成定点距离
    const slack = sample(seed, 'cpu.slack', [j], SLACK_RANGE) * 1
    const ease = sample(seed, 'cpu.ease', [j], tier.ease)
    const amp = sample(seed, 'cpu.amp', [j], AMP_RANGE)
    const tau = Math.max(1, Math.trunc(sample(seed, 'cpu.tau', [j], TAU_RANGE) / 10000))
    out.push({
      base,
      // 派生时约束 min ≤ base ≤ max，否则 base 会被 clamp 掉
      min: Math.min(min, base),
      max: Math.max(max, base),
      gain,
      slack,
      ease,
      amp,
      tau,
    })
  }
  return out
}
