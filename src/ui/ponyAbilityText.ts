import { ponyRule } from '../race/paid/ponyRules.ts'
import { PAID_CARD_GLOBALS } from '../race/paid/cardRules.ts'
import type { Lang } from './i18n.ts'

/** Copy reads all numeric ability parameters from the same rules used by the solver. */
export function ponyAbilityText(ponyId: number, lang: Lang): { name: string; description: string; strategy: string } {
  const rule = ponyRule(ponyId), en = lang === 'en'
  const speed = `+${(rule.bonusBps ?? 0) / 100}%`, seconds = (rule.durationMs ?? 0) / 1000
  const defaultSeconds = PAID_CARD_GLOBALS.bonusDefaultMs / 1000
  switch (rule.ability) {
    case 'rareSpecialist': return en
      ? { name: 'Rare Specialist', description: `Each acquired rare card adds ${speed} speed. Duration follows its card bonus: instant cards last ${defaultSeconds}s; permanent cards stay; theft follows stolen equipment.`, strategy: 'Rare cards and refreshes' }
      : { name: '稀有专精', description: `每获得稀有卡额外${speed}速度。时长跟随该卡附加效果：瞬时卡${defaultSeconds}秒，永久卡永久，窃取跟随装备。`, strategy: '稀有优先，刷新找稀有' }
    case 'light': return en
      ? { name: 'Travel Light', description: `Gain ${speed} speed while all equipment slots are empty.`, strategy: 'Speed, supplies and interference without equipment' }
      : { name: '轻装', description: `所有装备槽为空时速度${speed}；装备任何物品后移除。`, strategy: '无装备速度、补给与干扰' }
    case 'longEquipment': {
      const bonus = ((rule.equipmentDurationBps ?? 10000) - 10000) / 100
      return en ? { name: 'Long Attachment', description: `Equipment acquired from a card lasts ${bonus}% longer. Theft and renewal are not extended.`, strategy: 'Equipment coverage over the remaining track' }
        : { name: '长情', description: `选牌获得的装备初始时长+${bonus}%；偷来的装备与续期不延长。`, strategy: '装备覆盖更长路程' }
    }
    case 'diverse': return en
      ? { name: 'Bloom Together', description: `The first card of each main function adds ${speed} speed for ${seconds}s. Repeating a function does not trigger or renew it.`, strategy: 'Mix different card functions' }
      : { name: '百花齐放', description: `首次获得每种主功能卡时，速度${speed}，持续${seconds}秒；同类不触发、不续期。`, strategy: '不同主功能混搭' }
    case 'airborne': return en
      ? { name: 'Ride the Wind', description: `Gain ${speed} speed while airborne. Multiple airborne sources do not stack this bonus.`, strategy: 'Build around airborne states' }
      : { name: '乘风', description: `起飞期间速度${speed}；多个起飞来源不重复叠加。`, strategy: '起飞门控' }
    case 'ox': return en
      ? { name: 'Ox Strength', description: `Ongoing stamina cost +${(rule.costDeltaBps ?? 0) / 100}%; base speed cap +${rule.capDelta}. Capacity, recovery and one-time payments stay the same.`, strategy: 'Supplies and thrift sustain a higher cap' }
      : { name: '有牛劲', description: `持续体力消耗+${(rule.costDeltaBps ?? 0) / 100}%，基础速度上限+${rule.capDelta}；容量、恢复与一次性支付不变。`, strategy: '节流、补给支撑高上限' }
    case 'forfeit': return en
      ? { name: 'Whatever Works', description: `Actively skipping a checkpoint gives ${speed} speed for ${seconds}s. Timeouts and cut panels do not trigger it.`, strategy: 'Choose whether to take the card or skip' }
      : { name: '随便跑跑', description: `主动放弃检查点时速度${speed}，持续${seconds}秒；超时、非法选择与断卡不触发。`, strategy: '主动放弃的取舍' }
    case 'food': return en
      ? { name: 'Big Appetite', description: `A supply card that immediately restores stamina also restores ${(rule.staminaMicro ?? 0) / 1000000} extra stamina, capped. Periodic recovery does not trigger it.`, strategy: 'Immediate supplies' }
      : { name: '大吃货', description: `获得补给卡且当刻真实增加体力时，额外普通恢复${(rule.staminaMicro ?? 0) / 1000000}体力；周期恢复不触发，不产生超上限。`, strategy: '即时补给' }
    case 'repeat': return en
      ? { name: 'Repeat Rhythm', description: `Acquiring a card with a previously acquired main function gives ${speed} speed for ${seconds}s. Each card triggers at most once.`, strategy: 'Specialize in the same card function' }
      : { name: '重复节奏', description: `获得与此前卡牌同主功能的卡时，速度${speed}，持续${seconds}秒；每次获得至多触发一次。`, strategy: '同类专精' }
  }
}
