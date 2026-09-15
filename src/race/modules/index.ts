import { CARD_POOL } from '../cards/pool.ts'
import type { RaceModule } from '../core/module.ts'
import {
  modAirborne,
  modCosmetic,
  modDeath,
  modSpeed,
  modStack,
  modStamina,
  modSuppress,
  modTrail,
  modTrigger,
} from './basic.ts'
import {
  modAbilityBind,
  modCombo,
  modDraw,
  modEnv,
  modEquipment,
  modField,
  modHazard,
  modSteal,
  modSwap,
} from './entities.ts'

export const ALL_MODULES: RaceModule[] = [
  modSpeed,
  modStamina,
  modAirborne,
  modDeath,
  modStack,
  modEquipment,
  modAbilityBind,
  modSwap,
  modHazard,
  modField,
  modDraw,
  modEnv,
  modSteal,
  modTrigger,
  modCosmetic,
  modSuppress,
  modCombo,
  modTrail,
]

/**
 * 缺模块时在构建期失败，不在运行期静默无效——
 * 一张卡的效果悄悄不生效，是这类数据驱动设计最难查的 bug。
 */
export function assertModulesCoverPool(): void {
  const known = new Set(ALL_MODULES.map((m) => m.id))
  const missing: string[] = []
  for (const card of CARD_POOL) {
    for (const id of card.modules) {
      if (!known.has(id)) missing.push(`${card.cardId} -> ${id}`)
    }
    for (const e of card.effects) {
      if (!known.has(e.moduleId)) missing.push(`${card.cardId} effect -> ${e.moduleId}`)
    }
  }
  if (missing.length > 0) {
    throw new Error('卡牌依赖的模块缺失：\n' + missing.join('\n'))
  }
}

// 模块清单在导入时即自检，缺模块直接抛错
assertModulesCoverPool()
