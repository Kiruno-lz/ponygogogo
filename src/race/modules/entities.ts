/**
 * 重原语模块：equipment / ability-bind / swap / hazard / field / draw / env / steal / combo
 * 每一类都要动渲染层结构或赛道实体。
 */
import { TRACK_LEN } from '../core/constants.ts'
import { FP, clamp, divFx, mulFx, type Fixed } from '../core/fixed.ts'
import type { ModuleCtx, RaceModule } from '../core/module.ts'
import { H } from '../core/rng.ts'
import { paidCardRule } from '../paid/cardRules.ts'
import type { EffectInstance, EquipSlot, ModifierContribution } from '../core/types.ts'

const ALL_SLOTS: EquipSlot[] = ['torso', 'head', 'hoof_fl', 'hoof_fr', 'hoof_bl', 'hoof_br', 'tail']

function slotsOf(inst: EffectInstance): EquipSlot[] {
  const multi = inst.payload.multiSlot as EquipSlot[] | undefined
  if (multi) return multi
  return inst.payload.slot ? [inst.payload.slot] : []
}

// ---------------------------------------------------------------------------

export const modEquipment: RaceModule = {
  id: 'mod.equipment',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['equipment', 'removeByTag'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.primitive !== 'Equipment' || !inst.payload.equipId) return
      const slots = slotsOf(inst)
      if (slots.length === 0) return
      // 同一插槽同时只能装一件：旧的先完整卸载，再添加新的
      for (const slot of slots) {
        for (const other of ctx.equipmentOf(inst.ownerHorseId)) {
          if (other.instanceId === inst.instanceId) continue
          if (slotsOf(other).includes(slot)) {
            ctx.mut.remove('mod.equipment', other.instanceId)
          }
        }
        ctx.mut.setEquipSlot('mod.equipment', inst.ownerHorseId, slot, inst.instanceId)
        ctx.emit({
          type: 'equipOn',
          horseId: inst.ownerHorseId,
          equipId: inst.payload.equipId as string,
          slot,
          tick: ctx.state.tick,
        })
      }
    },
    onEffectRemove(ctx, inst) {
      if (inst.primitive !== 'Equipment' || !inst.payload.equipId) return
      for (const slot of slotsOf(inst)) {
        ctx.emit({
          type: 'equipOff',
          horseId: inst.ownerHorseId,
          equipId: inst.payload.equipId as string,
          slot,
          tick: ctx.state.tick,
        })
      }
    },
    onEffectExpire(ctx, inst) {
      if (inst.primitive !== 'Equipment' || !inst.payload.equipId) return
      for (const slot of slotsOf(inst)) {
        ctx.emit({
          type: 'equipOff',
          horseId: inst.ownerHorseId,
          equipId: inst.payload.equipId as string,
          slot,
          tick: ctx.state.tick,
        })
      }
    },
  },
}

// ---------------------------------------------------------------------------

const WHEEL_SRC = 'system.wheelhold'

export const modAbilityBind: RaceModule = {
  id: 'mod.ability-bind',
  version: 1,
  reads: ['horses', 'effects', 'input'],
  writes: ['abilityBind', 'removeByTag', 'status'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.primitive !== 'Ability' || !inst.payload.abilityId) return
      const prev = ctx.state.abilityBinding
      // 单槽替换：后获得的直接顶掉先获得的，被顶掉的实例直接消失
      if (prev && prev.instanceId !== inst.instanceId) {
        ctx.mut.remove('mod.ability-bind', prev.instanceId)
      }
      ctx.mut.bindAbility('mod.ability-bind', {
        abilityId: inst.payload.abilityId,
        instanceId: inst.instanceId,
        ownerHorseId: inst.ownerHorseId,
      })
    },
    onEffectRemove(ctx, inst) {
      if (inst.primitive === 'Ability') releaseWheel(ctx, inst.ownerHorseId)
    },
    onEffectExpire(ctx, inst) {
      if (inst.primitive === 'Ability') releaseWheel(ctx, inst.ownerHorseId)
    },
    onInputIntent(ctx, intent) {
      const b = ctx.state.abilityBinding
      if (!b) return false
      if (b.abilityId === 'wheelHold') {
        ctx.state.abilityHeld = intent === 'down'
        if (intent === 'up') releaseWheel(ctx, b.ownerHorseId)
        return true
      }
      // 拍手交换由 mod.swap 执行，这里只负责占用 gogo
      return intent === 'down'
    },
    onTick(ctx) {
      const b = ctx.state.abilityBinding
      if (!b || b.abilityId !== 'wheelHold') return
      if (!ctx.state.abilityHeld) {
        releaseWheel(ctx, b.ownerHorseId)
        return
      }
      const owner = b.ownerHorseId
      const existing = ctx
        .effectsOf(owner)
        .find((e) => e.sourceCardId === WHEEL_SRC && e.primitive === 'Status')
      if (!existing) {
        // 长按期间：临时【起飞】+ 加速 40%
        ctx.mut.mount('mod.ability-bind', {
          sourceCardId: WHEEL_SRC,
          primitive: 'Status',
          moduleId: 'mod.airborne',
          ownerHorseId: owner,
          durationTicks: null,
          tags: ['buff'],
          payload: { statusId: 'airborne' },
        })
        ctx.mut.mount('mod.ability-bind', {
          sourceCardId: WHEEL_SRC,
          primitive: 'Modifier',
          moduleId: 'mod.speed',
          ownerHorseId: owner,
          durationTicks: null,
          tags: ['buff'],
          payload: { modifiers: [{ target: 'speed', op: 'padd', pool: 'b1', value: 4000 }] },
        })
        ctx.emit({ type: 'statusAdd', horseId: owner, statusId: 'airborne', tick: ctx.state.tick })
      }
      // 每秒 +1 层【火焰】
      let burning = ctx.effectsOf(owner).find((e) => e.payload.statusId === 'burning')
      if (!burning) {
        burning = ctx.mut.mount('mod.ability-bind', {
          sourceCardId: 'C-11',
          primitive: 'Status',
          moduleId: 'mod.stack',
          ownerHorseId: owner,
          durationTicks: null,
          tags: ['debuff'],
          payload: { statusId: 'burning', stacks: 0, lastGainTick: ctx.state.tick - 50 },
        })
      }
      const last = (burning.payload.lastGainTick as number) ?? ctx.state.tick - 50
      if (ctx.state.tick - last >= 50) {
        burning.payload.stacks = ((burning.payload.stacks as number) ?? 0) + 1
        burning.payload.lastGainTick = ctx.state.tick
        ctx.emit({
          type: 'statusStack',
          horseId: owner,
          statusId: 'burning',
          stacks: burning.payload.stacks as number,
          tick: ctx.state.tick,
        })
      }
    },
  },
}

function releaseWheel(ctx: ModuleCtx, ownerHorseId: number): void {
  for (const e of ctx.effectsOf(ownerHorseId)) {
    if (e.sourceCardId === WHEEL_SRC) ctx.mut.remove('mod.ability-bind', e.instanceId)
  }
}

// ---------------------------------------------------------------------------

const SWAP_CD_TICKS = 100 // 2 秒

export const modSwap: RaceModule = {
  id: 'mod.swap',
  version: 1,
  reads: ['horses', 'input'],
  writes: ['pos', 'lane', 'speed'],
  hooks: {
    onInputIntent(ctx, intent) {
      if (intent !== 'down') return false
      const b = ctx.state.abilityBinding
      if (!b || b.abilityId !== 'clapSwap') return false
      const self = ctx.horseById(b.ownerHorseId)
      if (self.finished) return false
      if (ctx.hasStatus(self.horseId, 'swapCooldown')) return false
      // 看不见的马不会和别人换位置
      if (ctx.isBlinded(self.horseId)) return true

      const candidates = ctx.state.horses.filter(
        (h) =>
          !h.finished &&
          h.horseId !== self.horseId &&
          Math.abs(h.laneIndex - self.laneIndex) === 1 &&
          !ctx.isBlinded(h.horseId),
      )
      if (candidates.length === 0) return true
      candidates.sort((a, b2) => a.laneIndex - b2.laneIndex)
      const pick =
        candidates.length === 1
          ? 0
          : H(ctx.state.seed, 'swap', ctx.state.swapIndex) % candidates.length
      ctx.state.swapIndex++
      const other = candidates[pick]!

      // 交换 pos 与 laneIndex；里程各自保留，速度各自不变
      const selfPos = self.pos
      const otherPos = other.pos
      const selfLane = self.laneIndex
      const otherLane = other.laneIndex
      ctx.mut.jumpPos('mod.swap', self.horseId, otherPos)
      ctx.mut.jumpPos('mod.swap', other.horseId, selfPos)
      ctx.mut.setLane('mod.swap', self.horseId, otherLane)
      ctx.mut.setLane('mod.swap', other.horseId, selfLane)
      ctx.mut.mount('mod.swap', {
        sourceCardId: 'system.swapcd',
        primitive: 'Status',
        moduleId: 'mod.swap',
        ownerHorseId: self.horseId,
        durationTicks: SWAP_CD_TICKS,
        tags: ['system'],
        payload: { statusId: 'swapCooldown' },
      })
      ctx.emit({ type: 'swap', a: self.horseId, b: other.horseId, tick: ctx.state.tick })
      return true
    },
  },
}

// ---------------------------------------------------------------------------

export const modHazard: RaceModule = {
  id: 'mod.hazard',
  version: 1,
  reads: ['horses', 'hazards'],
  writes: ['hazard', 'speed', 'pos'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.payload.hazardKind !== 'bomb') return
      const owner = ctx.horseById(inst.ownerHorseId)
      // 给其他四条 laneIndex 赛道各放置一枚炸弹，位置为放置瞬间的 pos
      for (const h of ctx.state.horses) {
        if (h.laneIndex === owner.laneIndex) continue
        ctx.mut.spawnHazard('mod.hazard', {
          laneIndex: h.laneIndex,
          pos: owner.pos,
          sourceCardId: inst.sourceCardId,
        })
        ctx.emit({ type: 'hazardPlaced', laneIndex: h.laneIndex, pos: owner.pos, tick: ctx.state.tick })
      }
    },
    settleEntities(ctx, horse, from, to) {
      if (horse.finished) return
      // 悬空的马不触发地面炸弹；看不见的马炸不到
      if (ctx.hasStatus(horse.horseId, 'airborne')) return
      if (ctx.isBlinded(horse.horseId)) return
      for (const hz of [...ctx.state.hazards]) {
        if (hz.laneIndex !== horse.laneIndex) continue
        // 判定用位移区间而非坐标相等：高速下按坐标相等会漏判
        if (hz.pos > from && hz.pos <= to) {
          ctx.mut.clearHazard('mod.hazard', hz.hazardId)
          ctx.emit({
            type: 'explosion',
            laneIndex: hz.laneIndex,
            pos: hz.pos,
            horseId: horse.horseId,
            tick: ctx.state.tick,
          })
          ctx.requestDeath(horse.horseId)
          return
        }
      }
    },
  },
}

// ---------------------------------------------------------------------------

/** k = strength × max(0, 1 − d / R) */
function wellFactor(inst: EffectInstance, d: Fixed): Fixed {
  const radius = (inst.payload.radius as Fixed) ?? 1
  const strength = (inst.payload.strength as Fixed) ?? paidCardRule(10).strengthBps!
  if (d >= radius) return 0
  return mulFx(strength, FP - divFx(d, radius))
}

export const modField: RaceModule = {
  id: 'mod.field',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['field'],
  hooks: {
    /** 玩家这一侧：外部场贡献进 B3 子池，和卡牌增益在同一阶段 */
    contributeSpeed(ctx, horse) {
      if (!horse.isPlayer) return []
      const out: ModifierContribution[] = []
      for (const inst of ctx.state.effects) {
        if (inst.primitive !== 'Field' || inst.payload.fieldKind !== 'gravityWell') continue
        if (inst.ownerHorseId === horse.horseId) continue
        const owner = ctx.horseById(inst.ownerHorseId)
        if (owner.finished) continue
        const delta = horse.pos - owner.pos
        const k = wellFactor(inst, Math.abs(delta))
        if (k === 0) continue
        // 前方的马减速，后方的马加速
        out.push({
          target: 'speed',
          op: 'padd',
          pool: 'b3',
          value: delta > 0 ? -k : k,
          moduleId: 'mod.field',
          instanceId: inst.instanceId,
        })
      }
      return out
    },
    /** 电脑马这一侧：刻意排在阻尼之后、绕过 min/max，由最外层全局 clamp 兜住 */
    settleField(ctx) {
      for (const inst of ctx.state.effects) {
        if (inst.primitive !== 'Field' || inst.payload.fieldKind !== 'gravityWell') continue
        const owner = ctx.horseById(inst.ownerHorseId)
        if (owner.finished) continue
        for (const h of ctx.state.horses) {
          if (h.isPlayer || h.finished || h.horseId === owner.horseId) continue
          const delta = h.pos - owner.pos
          const k = wellFactor(inst, Math.abs(delta))
          if (k === 0) continue
          ctx.mut.addFieldMul('mod.field', h.horseId, delta > 0 ? -k : k)
        }
      }
    },
  },
}

// ---------------------------------------------------------------------------

export const modDraw: RaceModule = {
  id: 'mod.draw',
  version: 1,
  reads: ['deck'],
  writes: ['deckCursor'],
  hooks: {
    onEffectApply(ctx, inst) {
      const rule = inst.payload.drawRule
      if (!rule) return
      if (inst.ownerHorseId !== ctx.state.playerHorseId) return
      if (rule === 'refresh') {
        ctx.mut.addRefreshCredits('mod.draw', (inst.payload.credits as number) ?? 1)
      } else if (rule === 'auto') {
        ctx.mut.setDrawMode('mod.draw', 'auto')
        ctx.mut.addDrawBonus('mod.draw', (inst.payload.bonusPct as number) ?? 0)
      } else if (rule === 'cut') {
        ctx.mut.setDrawMode('mod.draw', 'cut')
      }
    },
    onDrawRequest(ctx, req) {
      return { ...req, mode: ctx.state.drawMode }
    },
  },
}

// ---------------------------------------------------------------------------

export const modEnv: RaceModule = {
  id: 'mod.env',
  version: 1,
  reads: ['horses', 'effects', 'env'],
  writes: ['env', 'field', 'removeByTag'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (inst.primitive !== 'Environment') return
      const prev = ctx.state.env
      if (prev && prev.instanceId !== inst.instanceId) {
        ctx.mut.remove('mod.env', prev.instanceId)
      }
      const dir: 1 | -1 = H(ctx.state.seed, 'wind', ctx.state.windIndex) % 2 === 0 ? 1 : -1
      ctx.state.windIndex++
      inst.payload.windDir = dir
      ctx.mut.setEnv('mod.env', inst)
      ctx.emit({ type: 'wind', dir, tick: ctx.state.tick })
    },
    /** 只作用于全场处于【起飞】状态的马，玩家与电脑马一视同仁 */
    contributeSpeed(ctx, horse) {
      const env = ctx.state.env
      if (!env || env.payload.envKind !== 'wind') return []
      if (!ctx.hasStatus(horse.horseId, 'airborne')) return []
      // 看不见的马不受其他马引发的全场天气影响
      if (ctx.isBlinded(horse.horseId)) return []
      const strength = (env.payload.strength as Fixed) ?? 1000
      const dir = (env.payload.windDir as number) ?? 1
      return [
        {
          target: 'speed',
          op: 'padd',
          pool: 'b4',
          value: dir > 0 ? strength : -strength,
          moduleId: 'mod.env',
          instanceId: env.instanceId,
        },
      ]
    },
  },
}

// ---------------------------------------------------------------------------

export const modSteal: RaceModule = {
  id: 'mod.steal',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['equipment', 'removeByTag'],
  hooks: {
    onEffectApply(ctx, inst) {
      if (!inst.payload.steal) return
      const thief = inst.ownerHorseId
      const loot: EffectInstance[] = []
      for (const h of ctx.state.horses) {
        if (h.horseId === thief || h.finished) continue
        loot.push(...ctx.equipmentOf(h.horseId))
      }
      // 场上没有任何装备时，这张牌没有效果，也不返还、不补抽
      if (loot.length === 0) return
      loot.sort((a, b) => a.instanceId - b.instanceId)
      const pick = H(ctx.state.seed, 'steal', ctx.state.stealIndex) % loot.length
      ctx.state.stealIndex++
      const target = loot[pick]!
      const from = target.ownerHorseId
      ctx.mut.remove('mod.steal', target.instanceId)
      // 时长刷新为该装备的完整时长
      const moved = ctx.mut.mount('mod.steal', {
        sourceCardId: target.sourceCardId,
        primitive: 'Equipment',
        moduleId: 'mod.equipment',
        ownerHorseId: thief,
        durationTicks: target.durationTicks,
        tags: target.tags,
        payload: { ...target.payload },
      })
      ctx.emit({
        type: 'steal',
        from,
        to: thief,
        equipId: moved.payload.equipId as string,
        tick: ctx.state.tick,
      })
    },
  },
}

// ---------------------------------------------------------------------------

/** 持有集合匹配与彩蛋结算：名次唯一不由位置推出的入口 */
export const modCombo: RaceModule = {
  id: 'mod.combo',
  version: 1,
  reads: ['horses', 'effects'],
  writes: ['forcedRank'],
  hooks: {
    checkTriggers(ctx) {
      if (ctx.state.forcedRank) return
      const pid = ctx.state.playerHorseId
      const held = new Set(ctx.effectsOf(pid).map((e) => e.sourceCardId))
      const hasAll = held.has('C-19') && held.has('C-21')
      const hasAny = held.has('C-17') || held.has('C-18')
      if (hasAll && hasAny) {
        ctx.mut.setForcedRank('mod.combo', pid, 1)
      }
    },
  },
}

export { ALL_SLOTS, clamp, TRACK_LEN }
