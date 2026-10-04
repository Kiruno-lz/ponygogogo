/**
 * 免费本地试玩的开场参数。试玩不建立链上会话、不经过任何端口，seed 与局号都在本地生成；
 * `?seed=0x…` 可以固定 seed，供确定性与动效用例复现同一场比赛。
 */
import { makeSeed } from './race/core/rng.ts'

const FORCED_SEED = /^0x[0-9a-fA-F]{8,64}$/

export function practiceForcedSeed(forced: string | null): string | null {
  return forced && FORCED_SEED.test(forced) ? forced : null
}

export function practiceSeed(forced: string | null, entropy: number): string {
  return practiceForcedSeed(forced) ?? makeSeed(entropy)
}

/** 本地局号：刻意不以 0x 开头，界面与海报都不会把它当成链上凭据 */
export function practiceRaceId(now: number, seq: number): string {
  return `local-${now.toString(36)}-${seq.toString(36)}`
}
