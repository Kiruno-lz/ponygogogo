/**
 * 规则常量。数值来自 docs/game-design.md §5 的 Demo 初始值表，
 * 属于「不定就无法构建」的基础量纲，不含任何平衡结论。
 */
import { FP, fx, type Fixed } from './fixed.ts'

/** 规则版本：模块清单与阶段顺序的组合指纹，进行中的比赛绑定入场时的版本 */
export const RULES_VERSION = 'demo-1'

export const SIM_HZ = 50
export const TICK_MS = 1000 / SIM_HZ // 20

/** 赛道长度：100000 距离单位，以定点表示 */
export const TRACK_LEN: Fixed = 100000 * FP

/** 玩家速度带基准（距离单位 / tick） */
export const PLAYER_V_LOW: Fixed = fx(24)
export const PLAYER_V_HIGH: Fixed = fx(40)

/** 加速度（速度 / tick） */
export const A_MAX: Fixed = fx(1)
export const A_IDLE: Fixed = fx(-1)

/** 全局硬上限，严格大于任何马的 max_i 与玩家的 vHigh */
export const V_HARD_MAX: Fixed = fx(80)

/** 体力 */
export const STAMINA_MAX: Fixed = fx(1000)
export const STAMINA_REGEN: Fixed = fx(1)
export const STAMINA_COST_FACTOR = 2 // cost = 2 * f̂
export const EXHAUST_RELEASE: Fixed = fx(300)

/** 节奏 */
export const RHYTHM_TARGET_MS = 500
export const RHYTHM_WINDOW_MS = 500
export const RHYTHM_MIN_INTERVAL_MS = 100
/** 被 Ability 占用期间的等效频率固定值 */
export const ABILITY_FHAT: Fixed = fx(0.5)

/** 里程检查点（占赛道长度的比例） */
export const CHECKPOINT_MARKS: Fixed[] = [
  Math.trunc(TRACK_LEN / 4),
  Math.trunc(TRACK_LEN / 2),
  Math.trunc((TRACK_LEN * 3) / 4),
]

/** 选牌现实限时 */
export const CARD_CHOICE_LIMIT_MS = 20000
/** 选牌期间的模拟速度倍率（0.1 倍） */
export const SLOWMO_NUM = 1
export const SLOWMO_DEN = 10

/** 起跑倒计时 */
export const COUNTDOWN_MS = 3000

/** 牌堆规模 */
export const DECK_SIZE = 14
export const DECK_RARE_TAIL = 2
export const CARDS_PER_CHECKPOINT = 3
export const CPU_DECK_SIZE = 3

/** 乘区钳制 */
export const B3_CLAMP: Fixed = fx(0.6)

/** 死亡恢复加速度下限 */
export const DEATH_RECOVER_ACCEL: Fixed = Math.trunc(A_MAX / 2)

/** 马匹数 */
export const HORSE_COUNT = 5

/** 下注档位（mock，单位 MON） */
export const STAKE_PRESETS = [0, 1, 5, 10] as const

/** 赔付表：名次 -> 返还倍率（定点） */
export const PAYOUT_TABLE: Fixed[] = [fx(3), fx(1.5), fx(1), fx(0), fx(0)]
