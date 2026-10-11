import { ponyRule } from '../../race/paid/ponyRules.ts'
import { PAID_CARD_GLOBALS } from '../../race/paid/cardRules.ts'
import { t, type Lang } from '../i18n.ts'

/** Copy reads all numeric ability parameters from the same rules used by the solver. */
export function ponyAbilityText(ponyId: number, lang: Lang): { name: string; description: string } {
  const rule = ponyRule(ponyId)
  const speed = `+${(rule.bonusBps ?? 0) / 100}%`, seconds = (rule.durationMs ?? 0) / 1000
  const defaultSeconds = PAID_CARD_GLOBALS.bonusDefaultMs / 1000
  switch (rule.ability) {
    case 'rareSpecialist': return { name: t(lang, 'pony.ability.rareSpecialist.name', {  }), description: t(lang, 'pony.ability.rareSpecialist.description', { speed: speed, defaultSeconds: defaultSeconds }) }
    case 'refresh': return { name: t(lang, 'pony.ability.refresh.name', {  }), description: t(lang, 'pony.ability.refresh.description', { refreshCount: rule.refreshCount! }) }
    case 'longEquipment': {
      const bonus = ((rule.equipmentDurationBps ?? 10000) - 10000) / 100
      return { name: t(lang, 'pony.ability.longEquipment.name', {  }), description: t(lang, 'pony.ability.longEquipment.description', { bonus: bonus, speed: speed }) }
    }
    case 'diverse': return { name: t(lang, 'pony.ability.diverse.name', {  }), description: t(lang, 'pony.ability.diverse.description', { speed: speed, seconds: seconds }) }
    case 'airborne': return { name: t(lang, 'pony.ability.airborne.name', {  }), description: t(lang, 'pony.ability.airborne.description', { speed: speed }) }
    case 'ox': return { name: t(lang, 'pony.ability.ox.name', {  }), description: t(lang, 'pony.ability.ox.description', { costDeltaPercent: (rule.costDeltaBps ?? 0) / 100, capDelta: rule.capDelta! }) }
    case 'forfeit': return { name: t(lang, 'pony.ability.forfeit.name', {  }), description: t(lang, 'pony.ability.forfeit.description', { speed: speed, seconds: seconds }) }
    case 'food': return { name: t(lang, 'pony.ability.food.name', {  }), description: t(lang, 'pony.ability.food.description', { staminaCapacityDelta: rule.staminaCapacityDelta!, staminaUnits: (rule.staminaMicro ?? 0) / 1000000 }) }
    case 'repeat': return { name: t(lang, 'pony.ability.repeat.name', {  }), description: t(lang, 'pony.ability.repeat.description', { speed: speed, seconds: seconds }) }
  }
}
