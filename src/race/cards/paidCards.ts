/**
 * 事件求时器卡面：名称与美术来自正式卡池，效果说明由 `paidCardRule` 生成。
 * 时长、百分比、固定值、体力和周期只有 src/race/paid/cardRules.ts 一个参数来源。
 */
import { PAID_CARD_RULES, type PaidCardRule } from '../paid/cardRules.ts'
import { localized } from '../../ui/i18n.ts'
import { CARD_METADATA } from './metadata.ts'
import type { CardView } from './types.ts'

const pct = (bps: number) => `${bps / 100}%`
const sec = (ms: number) => `${ms / 1000}`

function describe(rule: PaidCardRule, part: 'meme' | 'effect'): { zh: string; en: string } {
  const key = `card.C-${String(rule.id).padStart(2, '0')}.${part}`
  const d = rule.durationMs ?? 0
  switch (rule.effect) {
    case 'airborneSpeed':
      return localized(key, { pPercent: pct(rule.pBps!), durationSeconds: sec(d) })
    case 'speedDeath':
      return localized(key, { pPercent: pct(rule.pBps!), durationSeconds: sec(d) })
    case 'drawCut':
      return localized(key, { pPercent: pct(rule.pBps!), durationSeconds: sec(d) })
    case 'drawAuto':
      return localized(key, { bonusPercent: pct(rule.bonusBps!) })
    case 'refresh':
      return localized(key, { count: rule.count! })
    case 'bomb':
      return localized(key, {  })
    case 'rocket':
      return localized(key, { durationSeconds: sec(d), pPercent: pct(rule.pBps!) })
    case 'rainbow':
      return localized(key, { durationSeconds: sec(d), pPercent: pct(rule.pBps!) })
    case 'swap':
      return localized(key, { durationSeconds: sec(d), periodSeconds: sec(rule.periodMs!), count: rule.count! })
    case 'gravity':
      return localized(key, { durationSeconds: sec(d), strengthPercent: pct(rule.strengthBps!), radiusUnits: rule.radiusMicro! / 1e6 })
    case 'wheel':
      return localized(key, { durationSeconds: sec(d), flameLayers: rule.flameLayers!.join(' / '), fixedSpeed: rule.fixedSpeed! })
    case 'wind':
      return localized(key, { strengthPercent: pct(rule.strengthBps!) })
    case 'steal':
      return localized(key, {  })
    case 'regen':
      return localized(key, { regenBonusPercent: pct(rule.regenBonusBps!), durationSeconds: sec(d) })
    case 'adrenaline':
      return localized(key, { staminaUnits: rule.staminaMicro! / 1e6 })
    case 'wired':
      return localized(key, { durationSeconds: sec(d) })
    case 'fixed':
      return localized(key, { fixedSpeed: rule.fixedSpeed! })
    case 'coat':
      return rule.id === 19
        ? localized(key, {  })
        : localized(key, {  })
    case 'blindFixed':
      return localized(key, { fixedSpeed: rule.fixedSpeed! })
    case 'pay': return localized(key, { staminaUnits: rule.staminaMicro! / 1e6, fixedSpeed: rule.fixedSpeed!, durationSeconds: sec(d) })
    case 'phased': return localized(key, { periodSeconds: sec(rule.periodMs!), pPercent: pct(rule.pBps!), regenBonusPercent: pct(rule.regenBonusBps!), remainingSeconds: sec(d - rule.periodMs!), bonusPercent: pct(rule.bonusBps!), durationSeconds: sec(d) })
    case 'reserve': return localized(key, { pPercent: pct(rule.pBps!), periodSeconds: sec(rule.periodMs!), durationSeconds: sec(d), thresholdUnits: rule.thresholdMicro! / 1e6, staminaUnits: rule.staminaMicro! / 1e6 })
    case 'thrift': return localized(key, { costDeltaPercent: pct(rule.costDeltaBps!), durationSeconds: sec(d) })
    case 'rage': return localized(key, { pPercent: pct(rule.pBps!), costDeltaPercent: pct(rule.costDeltaBps!), durationSeconds: sec(d) })
    case 'paper': return localized(key, { pPercent: pct(rule.pBps!), durationSeconds: sec(d), bonusPercent: pct(rule.bonusBps!) })
    case 'ground': return localized(key, { durationSeconds: sec(d), pPercent: pct(rule.pBps!) })
    case 'coatGate': return localized(key, { regenBonusPercent: pct(rule.regenBonusBps!), pPercent: pct(rule.pBps!) })
    case 'recycle': return localized(key, { staminaUnits: rule.staminaMicro! / 1e6, pPercent: pct(rule.pBps!), fallbackPercent: pct(rule.fallbackBps!), durationSeconds: sec(d) })
    case 'tinker': return localized(key, { bonusPercent: pct(rule.bonusBps!), triggerDurationSeconds: sec(rule.triggerDurationMs!) })
    case 'renew': return localized(key, { pPercent: pct(rule.pBps!) })
    case 'unarmed': return localized(key, { durationSeconds: sec(d), pPercent: pct(rule.pBps!), fallbackPercent: pct(rule.fallbackBps!) })
    case 'target': return localized(key, { pPercent: pct(rule.pBps!), fallbackPercent: pct(rule.fallbackBps!), durationSeconds: sec(d) })
    case 'leader': return localized(key, { pPercent: pct(rule.pBps!), fallbackPercent: pct(rule.fallbackBps!), durationSeconds: sec(d) })
    case 'feast': return localized(key, { staminaUnits: rule.staminaMicro! / 1e6, pPercent: pct(rule.pBps!), durationSeconds: sec(d) })
    case 'guard': return localized(key, {  })
    case 'exhaustReserve': return localized(key, { durationSeconds: sec(d), staminaUnits: rule.staminaMicro! / 1e6 })
    case 'forfeit': return localized(key, { pPercent: pct(rule.pBps!), periodSeconds: sec(rule.periodMs!), staminaUnits: rule.staminaMicro! / 1e6, bonusPercent: pct(rule.bonusBps!), triggerDurationSeconds: sec(rule.triggerDurationMs!) })
    case 'mileage': return localized(key, { baseStages: rule.baseStages!.join(' / '), radiusUnits: rule.radiusMicro! / 1e6, count: rule.count! })
  }
}

const METADATA_BY_ID = new Map(CARD_METADATA.map(card => [card.cardId, card]))

/** Complete runtime faces; no duplicate effects, placeholder descriptions or second rarity/CPU table. */
export const PAID_CARD_POOL: readonly CardView[] = PAID_CARD_RULES.map(rule => {
  const cardId = `C-${String(rule.id).padStart(2, '0')}`
  const metadata = METADATA_BY_ID.get(cardId)
  if (!metadata) throw new Error(`MISSING_CARD_METADATA:${cardId}`)
  return { ...metadata, quality: rule.rare! ? 'rare' : 'common', cpuUsable: rule.cpu!, desc: describe(rule, 'effect'), meme: describe(rule, 'meme') }
})

const BY_ID = new Map(PAID_CARD_POOL.map(card => [card.cardId, card]))

/** 有奖卡面：`C-01` … `C-40`；未知 id 返回 undefined。 */
export function paidCardDef(key: string): CardView | undefined {
  return BY_ID.get(key)
}
