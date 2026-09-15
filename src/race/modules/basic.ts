/**
 * 纯数值与状态类模块：speed / stamina / airborne / death / stack / cosmetic / trail / trigger / suppress
 * 这些模块不需要场上实体、不需要渲染插槽。
 */
import { fx, type Fixed } from '../core/fixed.ts'
import type { ModuleCtx, RaceModule } from '../core/module.ts'
import type { EffectInstance, HorseState, ModifierContribution, ModifierDecl } from '../core/types.ts'

/** gate 求值：状态门控与资源门控共用同一个字段 */
function gateOpen(ctx: ModuleCtx, horse: HorseState, m: ModifierDecl): boolean {
  if (!m.gate) return true
  if (m.gate.status && !ctx.hasStatus(horse.horseId, m.gate.status)) return false
  if (m.gate.resource === 'stamina') {
    if (m.gate.below !== undefined && !(horse.stamina < m.gate.below)) return false
    if (m.gate.above !== undefined && !(horse.stamina > m.gate.above)) return false
  }
  return true
}

const SPEED_TARGETS = new Set(['speed', 'speedMax', 'speedMin', 'accel'])
const STAMINA_TARGETS = new Set(['staminaCost', 'staminaRegen'])

function collect(
  ctx: ModuleCtx,
  horse: HorseState,
  moduleId: string,
  wanted: Set<string>,
): ModifierContribution[] {
  const out: ModifierContribution[] = []
  for (const inst of ctx.effectsOf(horse.horseId)) {
    const mods = inst.payload.modifiers
    if (!mods) continue
    for (const m of mods) {
      if (!wanted.has(m.target)) continue
      if (!gateOpen(ctx, horse, m)) continue
      out.push({ ...m, moduleId, instanceId: inst.instanceId })
    }
  }
  return out
}

export const modSpeed: RaceModule = {
  id: 'mod.speed',
  version: 1,
  reads: ['horses', 'effects'],
  writes: [],
  hooks: {
    contributeSpeed(ctx, horse) {
      return collect(ctx, horse, 'mod.speed', SPEED_TARGETS)
    },
  },
}

export const modStamina: RaceModule = {
  id: 'mod.stamina',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['stamina'],
  hooks: {
    contributeStamina(ctx, horse) {
      return collect(ctx, horse, 'mod.stamina', STAMINA_TARGETS)
    },
    onEffectApply(ctx, inst) {
      const amount = inst.payload.instantStamina as Fixed | undefined
      if (amount) {
        // 一次性资源写入，允许 overcap
        ctx.mut.addStamina('mod.stamina', inst.ownerHorseId, amount)
      }
    },
  },
}

export const modAirborne: RaceModule = {
  id: 'mod.airborne',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['status'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.payload.statusId === 'airborne') {
        ctx.emit({ type: 'statusAdd', horseId: inst.ownerHorseId, statusId: 'airborne', tick: ctx.state.tick })
      }
    },
  },
}

export const modDeath: RaceModule = {
  id: 'mod.death',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['speed', 'pos', 'status'],
  hooks: {
    onEffectExpire(ctx, inst) {
      if (inst.payload.statusId === 'respawning') {
        ctx.emit({ type: 'respawnEnd', horseId: inst.ownerHorseId, tick: ctx.state.tick })
      }
    },
  },
}

/** 层数状态：【火焰】。获得速率由携带它的效果定义，衰减始终是停止获得 3 秒后每秒 −1 */
export const modStack: RaceModule = {
  id: 'mod.stack',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['status'],
  hooks: {
    onTick(ctx) {
      const tick = ctx.state.tick
      for (const inst of ctx.state.effects) {
        if (inst.payload.statusId !== 'burning') continue
        const lastGain = (inst.payload.lastGainTick as number) ?? inst.appliedAtTick
        const lastDecay = (inst.payload.lastDecayTick as number) ?? lastGain
        if (tick - lastGain >= 150 && tick - lastDecay >= 50) {
          const stacks = ((inst.payload.stacks as number) ?? 0) - 1
          inst.payload.stacks = Math.max(0, stacks)
          inst.payload.lastDecayTick = tick
          if (inst.payload.stacks === 0) {
            ctx.mut.remove('mod.stack', inst.instanceId)
          }
        }
      }
    },
  },
}

/** 外观状态与表现层剥夺：毛色（单槽替换）、视野 */
export const modCosmetic: RaceModule = {
  id: 'mod.cosmetic',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['status', 'removeByTag'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.payload.statusId === 'coat') {
        // 同时只有一个毛色生效：后染的盖掉先染的
        for (const other of ctx.effectsOf(inst.ownerHorseId)) {
          if (other.instanceId !== inst.instanceId && other.payload.statusId === 'coat') {
            ctx.mut.remove('mod.cosmetic', other.instanceId)
          }
        }
        ctx.emit({ type: 'statusAdd', horseId: inst.ownerHorseId, statusId: 'coat', tick: ctx.state.tick })
      }
      if (inst.payload.statusId === 'blindedPro') {
        ctx.emit({ type: 'statusAdd', horseId: inst.ownerHorseId, statusId: 'blindedPro', tick: ctx.state.tick })
      }
    },
  },
}

/** 拖尾：纯表现，零规则写入 */
export const modTrail: RaceModule = {
  id: 'mod.trail',
  version: 1,
  reads: ['horses', 'effects'],
  writes: [],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.payload.statusId === 'luckE') {
        ctx.emit({ type: 'statusAdd', horseId: inst.ownerHorseId, statusId: 'luckE', tick: ctx.state.tick })
      }
    },
  },
}

/** 条件触发器：到期、层数阈值、持有集合匹配 */
export const modTrigger: RaceModule = {
  id: 'mod.trigger',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['status'],
  hooks: {
    onEffectExpire(ctx, inst) {
      const t = inst.payload.trigger
      if (t?.kind === 'onExpire' && t.action === 'death') {
        ctx.requestDeath(inst.ownerHorseId)
      }
      // 【运气E】到期必定结算一次【死亡】
      if (inst.payload.statusId === 'luckE') {
        ctx.requestDeath(inst.ownerHorseId)
      }
    },
    checkTriggers(ctx) {
      // 【火焰】7 层立即结算一次【死亡】并清空层数
      for (const inst of [...ctx.state.effects]) {
        if (inst.payload.statusId !== 'burning') continue
        const stacks = (inst.payload.stacks as number) ?? 0
        if (stacks >= 7) {
          ctx.requestDeath(inst.ownerHorseId)
          inst.payload.stacks = 0
          ctx.mut.remove('mod.trigger', inst.instanceId)
        }
      }
    },
  },
}

/** 按 tag 抑制/移除效果实例，含系统自持的力竭惩罚 */
export const modSuppress: RaceModule = {
  id: 'mod.suppress',
  version: 1,
  reads: ['effects'],
  writes: ['removeByTag', 'status'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.payload.statusId !== 'wired') return
      // 【亢奋】抑制【力竭】：按 tag 移除系统自持的那条实例，而不是在体力模块里插特判
      ctx.mut.removeByTag('mod.suppress', inst.ownerHorseId, 'system', 'system.exhaust')
      ctx.emit({ type: 'statusAdd', horseId: inst.ownerHorseId, statusId: 'wired', tick: ctx.state.tick })
    },
    onTick(ctx) {
      for (const inst of ctx.state.effects) {
        if (inst.payload.statusId !== 'wired') continue
        ctx.mut.removeByTag('mod.suppress', inst.ownerHorseId, 'system', 'system.exhaust')
      }
    },
  },
}

export { fx }
export type { EffectInstance }
