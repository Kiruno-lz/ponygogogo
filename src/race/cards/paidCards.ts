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
      return { zh: `躯干装备史瓦西黑洞 ${sec(d)} 秒：全场前方的马减速、后方的马加速，越近越强，最多 ${pct(rule.strengthBps!)}，相距 ${rule.radiusMicro! / 1e6} 单位时减半。`, en: `Torso black hole for ${sec(d)}s: across the whole track, horses ahead slow and horses behind speed up; stronger when closer, up to ${pct(rule.strengthBps!)}, halved at ${rule.radiusMicro! / 1e6} units apart.` }
    case 'wheel':
      return { zh: `四蹄装备风火轮 ${sec(d)} 秒：【起飞】。装备时立即获得 1 层火焰，之后每秒 +1 层，层数不清零；在 ${rule.flameLayers!.join(' / ')} 层时各获得【额外速度】+${rule.fixedSpeed}，累计加入 K。装备消失或被拿走时，其火焰与额外速度全部消失。`, en: `Fire wheels for ${sec(d)}s: Airborne. Gain 1 flame layer immediately, then 1 per second without resetting; layers ${rule.flameLayers!.join(', ')} each grant +${rule.fixedSpeed} extra speed in K. Removing the equipment removes all its layers and extra speed.` }
    case 'wind':
      return { zh: `刮起顺风或逆风（±${pct(rule.strengthBps!)}），只吹得动【起飞】的马，替换之前的风。`, en: `A tail or head wind (±${pct(rule.strengthBps!)}) that only moves Airborne horses; replaces any earlier wind.` }
    case 'steal':
      return { zh: '从其他未冲线的马身上随机偷一件装备装到自己身上，继承来源剩余时长；没有装备时无效。', en: 'Steal a random piece of equipment from a horse still racing, with its remaining duration; nothing happens if none is worn.' }
    case 'regen':
      return { zh: `体力恢复 +${pct(rule.regenBonusBps!)}，持续 ${sec(d)} 秒。`, en: `Stamina regeneration +${pct(rule.regenBonusBps!)} for ${sec(d)}s.` }
    case 'adrenaline':
      return { zh: `体力 +${rule.staminaMicro! / 1e6}。`, en: `+${rule.staminaMicro! / 1e6} stamina.` }
    case 'wired':
      return { zh: `获得【亢奋】，持续 ${sec(d)} 秒：期间体力值不低于 1。`, en: `Gain Wired for ${sec(d)}s: stamina stays at or above 1.` }
    case 'fixed':
      return { zh: `【固定速度】+${rule.fixedSpeed}，加入基础速度 b，参与百分比加速。`, en: `Fixed base speed +${rule.fixedSpeed}, added to b before percentage bonuses.` }
    case 'coat':
      return rule.id === 19
        ? { zh: '头顶戴上一撮金色尖发。酷酷的！', en: 'A tuft of golden spikes on your head. Looks cool!' }
        : { zh: '头顶戴上一撮绿色尖发。酷酷的！', en: 'A tuft of green spikes on your head. Looks cool!' }
    case 'blindFixed':
      return { zh: `【固定速度】+${rule.fixedSpeed}，加入基础速度 b；【目中无人】：他马的炸弹、风与交换对你无效。`, en: `Fixed base speed +${rule.fixedSpeed}, added to b; Blinded Pro: other horses' bombs, wind and swaps skip you.` }
    case 'pay': return { zh: `支付 ${rule.staminaMicro! / 1e6} 体力，最多扣至 0；获得【额外速度】+${rule.fixedSpeed}，持续 ${sec(d)} 秒，加入 K。`, en: `Pay ${rule.staminaMicro! / 1e6} stamina, stopping at 0; gain +${rule.fixedSpeed} extra speed in K for ${sec(d)}s.` }
    case 'phased': return { zh: `前 ${sec(rule.periodMs!)} 秒速度 ${pct(rule.pBps!)}、恢复 +${pct(rule.regenBonusBps!)}；随后 ${sec(d - rule.periodMs!)} 秒速度 +${pct(rule.bonusBps!)}。`, en: `${pct(rule.pBps!)} speed and +${pct(rule.regenBonusBps!)} regeneration for ${sec(rule.periodMs!)}s, then +${pct(rule.bonusBps!)} speed for ${sec(d - rule.periodMs!)}s (${sec(d)}s total).` }
    case 'reserve': return { zh: `速度 +${pct(rule.pBps!)} ${sec(rule.periodMs!)} 秒；${sec(d)} 秒内首次体力低于 ${rule.thresholdMicro! / 1e6} 时，体力 +${rule.staminaMicro! / 1e6}，仅一次。`, en: `+${pct(rule.pBps!)} speed for ${sec(rule.periodMs!)}s; the first time stamina is below ${rule.thresholdMicro! / 1e6} within ${sec(d)}s, gain ${rule.staminaMicro! / 1e6} stamina once.` }
    case 'thrift': return { zh: `体力消耗 ${pct(rule.costDeltaBps!)}，持续 ${sec(d)} 秒。`, en: `${pct(rule.costDeltaBps!)} stamina cost for ${sec(d)}s.` }
    case 'rage': return { zh: `速度 +${pct(rule.pBps!)}，体力消耗 +${pct(rule.costDeltaBps!)}，持续 ${sec(d)} 秒。`, en: `+${pct(rule.pBps!)} speed and +${pct(rule.costDeltaBps!)} stamina cost for ${sec(d)}s.` }
    case 'paper': return { zh: `速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒；【起飞】时再 +${pct(rule.bonusBps!)}。本卡不提供起飞。`, en: `+${pct(rule.pBps!)} speed for ${sec(d)}s; Airborne adds +${pct(rule.bonusBps!)}. Does not grant Airborne.` }
    case 'ground': return { zh: `${sec(d)} 秒内，未【起飞】时速度 +${pct(rule.pBps!)}。`, en: `+${pct(rule.pBps!)} speed while grounded, for ${sec(d)}s.` }
    case 'coatGate': return { zh: `永久效果：已获得 1 种毛发颜色时体力恢复 +${pct(rule.regenBonusBps!)}；已获得 2 种时保留恢复加成，同时速度 +${pct(rule.pBps!)}。获得本卡时检测历史颜色数量，后续获得新颜色时更新；无毛发时无数值效果。`, en: `Permanent: one acquired hair color grants +${pct(rule.regenBonusBps!)} regeneration; two retain regeneration and also grant +${pct(rule.pBps!)} speed. Check acquired colors immediately and update after each new color; no effect without hair.` }
    case 'recycle': return { zh: `体力 +${rule.staminaMicro! / 1e6}；有装备时回收剩余时长最短的一件，速度 +${pct(rule.pBps!)}；无装备时速度 +${pct(rule.fallbackBps!)}，均持续 ${sec(d)} 秒。`, en: `Gain ${rule.staminaMicro! / 1e6} stamina; recycle your soonest-expiring equipment for +${pct(rule.pBps!)} speed, or +${pct(rule.fallbackBps!)} without equipment, both for ${sec(d)}s.` }
    case 'tinker': return { zh: `每次实际获得装备，独立获得速度 +${pct(rule.bonusBps!)}，持续 ${sec(rule.triggerDurationMs!)} 秒。获得本卡时按当前每件装备各触发一次；刷新装备不触发。`, en: `Each real equipment acquisition grants an independent +${pct(rule.bonusBps!)} speed for ${sec(rule.triggerDurationMs!)}s. Each currently equipped item triggers once on acquisition of this card; equipment refreshes do not trigger.` }
    case 'renew': return { zh: '刷新自身全部有效装备至各自完整持续时间；每件装备各生成独立速度 +10%，持续该装备的完整时长。保留装备层数与周期相位；移除装备不撤销独立加速。无装备时无效。', en: 'Refresh every active equipment to its full duration; each grants an independent +10% speed for that equipment’s full duration. Preserve equipment layers and phase; removing equipment does not cancel the independent buff. No effect without equipment.' }
    case 'unarmed': return { zh: `${sec(d)} 秒内，无任何装备时速度 +${pct(rule.pBps!)}，否则 ${pct(rule.fallbackBps!)}。`, en: `For ${sec(d)}s, +${pct(rule.pBps!)} speed without any equipment, otherwise ${pct(rule.fallbackBps!)}.` }
    case 'target': return { zh: `自身速度 +${pct(rule.pBps!)}；前方最近且未冲线、非【目中无人】的马速度 ${pct(rule.fallbackBps!)}，持续 ${sec(d)} 秒。不限距离，锁定目标。`, en: `You gain +${pct(rule.pBps!)} speed; nearest eligible unfinished horse ahead gets ${pct(rule.fallbackBps!)} for ${sec(d)}s. Unlimited range, fixed target; skips Blinded Pro.` }
    case 'leader': return { zh: `当前物理第一则速度 +${pct(rule.pBps!)}，否则 +${pct(rule.fallbackBps!)}，持续 ${sec(d)} 秒。`, en: `If physically first now, +${pct(rule.pBps!)} speed; otherwise +${pct(rule.fallbackBps!)} for ${sec(d)}s.` }
    case 'feast': return { zh: `所有马体力 +${rule.staminaMicro! / 1e6}；自身速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒。`, en: `Every horse gains ${rule.staminaMicro! / 1e6} stamina; you gain +${pct(rule.pBps!)} speed for ${sec(d)}s.` }
    case 'guard': return { zh: '永久等待：拦截下一次死亡，仅一次。重生免疫不消耗此效果。', en: 'Wait forever: block your next death once. Respawn immunity does not consume it.' }
    case 'exhaustReserve': return { zh: `${sec(d)} 秒内首次将进入力竭时，不进入力竭状态，并获得体力 +${rule.staminaMicro! / 1e6}，仅一次。`, en: `The first exhaustion within ${sec(d)}s is prevented and grants ${rule.staminaMicro! / 1e6} stamina, once.` }
    case 'forfeit': return { zh: `速度 ${pct(rule.pBps!)} ${sec(rule.periodMs!)} 秒；此后首次主动放弃选牌，恢复 ${rule.staminaMicro! / 1e6} 体力、速度 +${pct(rule.bonusBps!)} ${sec(rule.triggerDurationMs!)} 秒。超时不触发。`, en: `${pct(rule.pBps!)} speed for ${sec(rule.periodMs!)}s. First future active forfeit restores ${rule.staminaMicro! / 1e6} stamina and +${pct(rule.bonusBps!)} speed for ${sec(rule.triggerDurationMs!)}s. Timeouts do not trigger.` }
    case 'mileage': return { zh: `【固定速度】${rule.baseStages!.join(' / +')}；获得本卡时独立统计里程，每 ${rule.radiusMicro! / 1e6} 距离增加一层，最多 ${rule.count} 层；固定速度加入 b。交换位置不计里程。`, en: `Fixed base speed stages ${rule.baseStages!.join(' / +')}, added to b. Track private mileage from this card's acquisition: one stage per ${rule.radiusMicro! / 1e6} distance, up to ${rule.count} stages; swaps add no mileage.` }
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
