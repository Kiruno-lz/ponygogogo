/**
 * 事件求时器卡面：名称与美术来自正式卡池，效果说明由 `paidCardRule` 生成。
 * 时长、百分比、固定值、体力和周期只有 src/race/paid/cardRules.ts 一个参数来源。
 */
import { PAID_CARD_RULES, type PaidCardRule } from '../paid/cardRules.ts'
import { CARD_METADATA } from './metadata.ts'
import type { CardView } from './types.ts'

const pct = (bps: number) => `${bps / 100}%`
const sec = (ms: number) => `${ms / 1000}`

function describe(rule: PaidCardRule): { zh: string; en: string } {
  const d = rule.durationMs ?? 0
  switch (rule.effect) {
    case 'airborneSpeed':
      return { zh: `获得【起飞】，速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒。起飞的马不触发地面炸弹。`, en: `Airborne and +${pct(rule.pBps!)} speed for ${sec(d)}s. Airborne horses skip ground bombs.` }
    case 'speedDeath':
      return { zh: `速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒；到期时【死亡】一次。`, en: `+${pct(rule.pBps!)} speed for ${sec(d)}s; you die once when it ends.` }
    case 'drawCut':
      return { zh: `速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒。代价：此后的检查点不再发牌。`, en: `+${pct(rule.pBps!)} speed for ${sec(d)}s. Cost: no more cards at later checkpoints.` }
    case 'drawAuto':
      return { zh: `此后的检查点自动选牌、不能刷新；此后获得的每张卡额外 +${pct(rule.bonusBps!)} 速度。`, en: `Later checkpoints pick for you and cannot refresh; every later card adds +${pct(rule.bonusBps!)} speed.` }
    case 'refresh':
      return { zh: `刷新额度 +${rule.count}：之后的检查点可以换掉一张候选，由牌堆末端顶替。`, en: `+${rule.count} refresh: swap one offered card at a later checkpoint for one from the deck's end.` }
    case 'bomb':
      return { zh: '在其他四条赛道、你当前的位置各放一枚炸弹，踩到的马【死亡】。', en: 'Drops a bomb at your position in each of the other four lanes; a horse that runs over one dies.' }
    case 'rocket':
      return { zh: `躯干装备火箭喷射器 ${sec(d)} 秒：速度 +${pct(rule.pBps!)}，体力消耗减半。`, en: `Torso rocket for ${sec(d)}s: +${pct(rule.pBps!)} speed, half stamina cost.` }
    case 'rainbow':
      return { zh: `尾部装备彩虹拖尾 ${sec(d)} 秒：速度 +${pct(rule.pBps!)}。`, en: `Rainbow tail for ${sec(d)}s: +${pct(rule.pBps!)} speed.` }
    case 'swap':
      return { zh: `【拍手交换】${sec(d)} 秒：每 ${sec(rule.periodMs!)} 秒自动与另一条赛道的马交换位置，共 ${rule.count} 次。`, en: `Clap Swap for ${sec(d)}s: every ${sec(rule.periodMs!)}s trade places with a horse in another lane, ${rule.count} tries.` }
    case 'gravity':
      return { zh: `躯干装备史瓦西黑洞 ${sec(d)} 秒：${rule.radiusMicro! / 1e6} 单位内，前方的马减速、后方的马加速，最多 ${pct(rule.strengthBps!)}。`, en: `Torso black hole for ${sec(d)}s: within ${rule.radiusMicro! / 1e6} units, horses ahead slow and horses behind speed up, up to ${pct(rule.strengthBps!)}.` }
    case 'wheel':
      return { zh: `四蹄装备风火轮 ${sec(d)} 秒：【起飞】，每 ${sec(rule.periodMs!)} 秒速度 +${rule.fixedSpeed}，初始时长内 ${rule.count} 次，翻新后继续按原周期触发。`, en: `Fire wheels for ${sec(d)}s: Airborne, +${rule.fixedSpeed} speed every ${sec(rule.periodMs!)}s, ${rule.count} bursts in the initial duration; refurbishing extends the cycle.` }
    case 'wind':
      return { zh: `刮起顺风或逆风（±${pct(rule.strengthBps!)}），只吹得动【起飞】的马，替换之前的风。`, en: `A tail or head wind (±${pct(rule.strengthBps!)}) that only moves Airborne horses; replaces any earlier wind.` }
    case 'steal':
      return { zh: '从其他未冲线的马身上随机偷一件装备装到自己身上，时长刷新；没有装备时无效。', en: 'Steal a random piece of equipment from a horse still racing, at full duration; nothing happens if none is worn.' }
    case 'regen':
      return { zh: `体力恢复 +${pct(rule.regenBonusBps!)}，持续 ${sec(d)} 秒。`, en: `Stamina regeneration +${pct(rule.regenBonusBps!)} for ${sec(d)}s.` }
    case 'adrenaline':
      return { zh: `体力 +${rule.staminaMicro! / 1e6}，可以超过上限。`, en: `+${rule.staminaMicro! / 1e6} stamina, may exceed the cap.` }
    case 'wired':
      return { zh: `【亢奋】${sec(d)} 秒：体力见底也不会力竭。`, en: `Wired for ${sec(d)}s: an empty stamina bar does not exhaust you.` }
    case 'fixed':
      return { zh: `速度固定 +${rule.fixedSpeed}，永久。`, en: `Speed +${rule.fixedSpeed}, permanent.` }
    case 'coat':
      return rule.id === 19
        ? { zh: '头顶戴上一撮金色尖发。酷酷的！', en: 'A tuft of golden spikes on your head. Looks cool!' }
        : { zh: '头顶戴上一撮绿色尖发。酷酷的！', en: 'A tuft of green spikes on your head. Looks cool!' }
    case 'blindFixed':
      return { zh: `速度固定 +${rule.fixedSpeed}；【目中无人】：他马的炸弹、风与交换对你无效。`, en: `Speed +${rule.fixedSpeed}; Blinded Pro: other horses' bombs, wind and swaps skip you.` }
    case 'pay': return { zh: `支付至多 ${rule.staminaMicro! / 1e6} 体力，按支付比例获得最多 +${pct(rule.pBps!)} 速度，持续 ${sec(d)} 秒。`, en: `Spend up to ${rule.staminaMicro! / 1e6} stamina for proportional speed, up to +${pct(rule.pBps!)} for ${sec(d)}s.` }
    case 'phased': return { zh: `前 ${sec(rule.periodMs!)} 秒速度 ${pct(rule.pBps!)}、恢复 +${pct(rule.regenBonusBps!)}；随后 ${sec(d - rule.periodMs!)} 秒速度 +${pct(rule.bonusBps!)}。`, en: `${pct(rule.pBps!)} speed and +${pct(rule.regenBonusBps!)} regeneration for ${sec(rule.periodMs!)}s, then +${pct(rule.bonusBps!)} speed for ${sec(d - rule.periodMs!)}s (${sec(d)}s total).` }
    case 'reserve': return { zh: `速度 +${pct(rule.pBps!)} ${sec(rule.periodMs!)} 秒；${sec(d)} 秒内首次体力 ≤${rule.thresholdMicro! / 1e6} 时恢复 ${rule.staminaMicro! / 1e6}，不超过上限。`, en: `+${pct(rule.pBps!)} speed for ${sec(rule.periodMs!)}s. Within ${sec(d)}s, first stamina ≤${rule.thresholdMicro! / 1e6} restores ${rule.staminaMicro! / 1e6}, capped.` }
    case 'thrift': return { zh: `速度 ${pct(rule.pBps!)}、体力消耗 ${pct(rule.costDeltaBps!)}，持续 ${sec(d)} 秒。`, en: `${pct(rule.pBps!)} speed, ${pct(rule.costDeltaBps!)} stamina cost for ${sec(d)}s.` }
    case 'rage': return { zh: `速度 +${pct(rule.pBps!)}、消耗 +${pct(rule.costDeltaBps!)}，持续 ${sec(d)} 秒；【亢奋】时再 +${pct(rule.bonusBps!)} 速度。`, en: `+${pct(rule.pBps!)} speed, +${pct(rule.costDeltaBps!)} cost for ${sec(d)}s; Wired adds +${pct(rule.bonusBps!)} speed.` }
    case 'paper': return { zh: `速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒；【起飞】时再 +${pct(rule.bonusBps!)}。本卡不提供起飞。`, en: `+${pct(rule.pBps!)} speed for ${sec(d)}s; Airborne adds +${pct(rule.bonusBps!)}. Does not grant Airborne.` }
    case 'ground': return { zh: `${sec(d)} 秒内，未【起飞】时速度 +${pct(rule.pBps!)}。`, en: `+${pct(rule.pBps!)} speed while grounded, for ${sec(d)}s.` }
    case 'coatGate': return { zh: `${sec(d)} 秒内：黄毛速度 +${pct(rule.pBps!)}；绿毛恢复 +${pct(rule.regenBonusBps!)}；其他毛色速度 +${pct(rule.fallbackBps!)}。`, en: `For ${sec(d)}s: yellow coat +${pct(rule.pBps!)} speed; green +${pct(rule.regenBonusBps!)} regeneration; other coats +${pct(rule.fallbackBps!)} speed.` }
    case 'recycle': return { zh: `回收剩余时长最短的自身装备，恢复 ${rule.staminaMicro! / 1e6} 体力，速度 +${pct(rule.pBps!)} ${sec(d)} 秒；无装备则 +${pct(rule.fallbackBps!)} ${sec(rule.periodMs!)} 秒。`, en: `Recycle your soonest-expiring equipment, restore ${rule.staminaMicro! / 1e6} stamina, +${pct(rule.pBps!)} speed for ${sec(d)}s; without equipment +${pct(rule.fallbackBps!)} for ${sec(rule.periodMs!)}s.` }
    case 'tinker': return { zh: `速度 +${pct(rule.pBps!)} ${sec(rule.periodMs!)} 秒；永久监听实际获得装备，每次再 +${pct(rule.bonusBps!)} ${sec(rule.triggerDurationMs!)} 秒。已有装备立即触发一次。翻新不触发。`, en: `+${pct(rule.pBps!)} speed for ${sec(rule.periodMs!)}s. Every real equipment acquisition adds +${pct(rule.bonusBps!)} for ${sec(rule.triggerDurationMs!)}s forever; existing equipment triggers once. Refurbishing does not trigger.` }
    case 'renew': return { zh: `将自身全部有效装备刷新至完整时长，保留周期相位与历史收益；无装备则速度 +${pct(rule.fallbackBps!)} ${sec(rule.periodMs!)} 秒。`, en: `Refresh all active equipment to full duration; keep periodic phase and past gains. Without equipment +${pct(rule.fallbackBps!)} speed for ${sec(rule.periodMs!)}s.` }
    case 'unarmed': return { zh: `${sec(d)} 秒内，无任何装备时速度 +${pct(rule.pBps!)}，否则 ${pct(rule.fallbackBps!)}。`, en: `For ${sec(d)}s, +${pct(rule.pBps!)} speed without any equipment, otherwise ${pct(rule.fallbackBps!)}.` }
    case 'target': return { zh: `自身速度 +${pct(rule.pBps!)}；前方最近且未冲线、非【目中无人】的马速度 ${pct(rule.fallbackBps!)}，持续 ${sec(d)} 秒。不限距离，锁定目标。`, en: `You gain +${pct(rule.pBps!)} speed; nearest eligible unfinished horse ahead gets ${pct(rule.fallbackBps!)} for ${sec(d)}s. Unlimited range, fixed target; skips Blinded Pro.` }
    case 'leader': return { zh: `当前物理第一则速度 +${pct(rule.pBps!)}，否则 +${pct(rule.fallbackBps!)}，持续 ${sec(d)} 秒。`, en: `If physically first now, +${pct(rule.pBps!)} speed; otherwise +${pct(rule.fallbackBps!)} for ${sec(d)}s.` }
    case 'feast': return { zh: `所有未冲线的马恢复 ${rule.staminaMicro! / 1e6} 体力，不超过上限；自身速度 +${pct(rule.pBps!)} ${sec(d)} 秒。`, en: `All unfinished horses restore ${rule.staminaMicro! / 1e6} stamina, capped; you gain +${pct(rule.pBps!)} speed for ${sec(d)}s.` }
    case 'guard': return { zh: '永久等待：拦截下一次死亡，仅一次。重生免疫不消耗此效果。', en: 'Wait forever: block your next death once. Respawn immunity does not consume it.' }
    case 'deathBurst': return { zh: `${sec(d)} 秒内首次实际死亡后，速度固定 +${rule.fixedSpeed} ${sec(rule.triggerDurationMs!)} 秒；不立即加速。再次死亡清除该收益。`, en: `First actual death within ${sec(d)}s grants fixed +${rule.fixedSpeed} speed for ${sec(rule.triggerDurationMs!)}s. No upfront speed; another death clears it.` }
    case 'forfeit': return { zh: `速度 ${pct(rule.pBps!)} ${sec(rule.periodMs!)} 秒；此后首次主动放弃选牌，恢复 ${rule.staminaMicro! / 1e6} 体力、速度 +${pct(rule.bonusBps!)} ${sec(rule.triggerDurationMs!)} 秒。超时不触发。`, en: `${pct(rule.pBps!)} speed for ${sec(rule.periodMs!)}s. First future active forfeit restores ${rule.staminaMicro! / 1e6} stamina and +${pct(rule.bonusBps!)} speed for ${sec(rule.triggerDurationMs!)}s. Timeouts do not trigger.` }
    case 'mileage': return { zh: `速度固定 ${rule.fixedSpeed}；此后每跑过 ${rule.radiusMicro! / 1e9}% 赛道，固定 +${rule.triggerFixedSpeed}，最多 ${rule.count} 次。交换位置不算里程，死亡不重置次数。`, en: `Fixed ${rule.fixedSpeed} speed. Each further ${rule.radiusMicro! / 1e9}% of track run grants +${rule.triggerFixedSpeed}, at most ${rule.count} times. Swaps add no mileage; death does not reset triggers.` }
  }
}

const METADATA_BY_ID = new Map(CARD_METADATA.map(card => [card.cardId, card]))

/** Complete runtime faces; no legacy effects, placeholder descriptions or second rarity/CPU table. */
export const PAID_CARD_POOL: readonly CardView[] = PAID_CARD_RULES.map(rule => {
  const cardId = `C-${String(rule.id).padStart(2, '0')}`
  const metadata = METADATA_BY_ID.get(cardId)
  if (!metadata) throw new Error(`MISSING_CARD_METADATA:${cardId}`)
  return { ...metadata, quality: rule.rare ? 'rare' : 'common', cpuUsable: rule.cpu, desc: describe(rule) }
})

const BY_ID = new Map(PAID_CARD_POOL.map(card => [card.cardId, card]))

/** 有奖卡面：`C-01` … `C-40`；未知 id 返回 undefined。 */
export function paidCardDef(key: string): CardView | undefined {
  return BY_ID.get(key)
}
