/** Canonical role abilities. Solidity data is generated from this table. */
import { keccak256, toBytes } from 'viem'
export const PONY_ABILITY = {
  rareSpecialist: 0, light: 1, longEquipment: 2, diverse: 3, airborne: 4,
  ox: 5, forfeit: 6, food: 7, repeat: 8,
} as const

export type PonyRule = {
  id: number
  enabled: boolean
  ability: keyof typeof PONY_ABILITY
  bonusBps?: number
  durationMs?: number
  equipmentDurationBps?: number
  capDelta?: number
  costDeltaBps?: number
  staminaMicro?: number
}

export const PONY_RULES: readonly PonyRule[] = [
  { id: 0, enabled: true, ability: 'rareSpecialist', bonusBps: 1000 },
  { id: 1, enabled: true, ability: 'light', bonusBps: 800 },
  { id: 2, enabled: true, ability: 'longEquipment', equipmentDurationBps: 12000 },
  { id: 3, enabled: true, ability: 'diverse', bonusBps: 700, durationMs: 20000 },
  { id: 4, enabled: true, ability: 'airborne', bonusBps: 800 },
  { id: 5, enabled: true, ability: 'ox', capDelta: 100, costDeltaBps: 2000 },
  { id: 6, enabled: true, ability: 'forfeit', bonusBps: 1200, durationMs: 20000 },
  { id: 7, enabled: true, ability: 'food', staminaMicro: 50000000 },
  { id: 8, enabled: true, ability: 'repeat', bonusBps: 1200, durationMs: 20000 },
]

export function ponyRule(id: number): PonyRule {
  const rule = PONY_RULES.find(r => r.id === id)
  if (!rule) throw new Error('INVALID_PONY')
  return rule
}

export function ponyRuleTuple(rule: PonyRule): number[] {
  return [rule.id, rule.enabled ? 1 : 0, PONY_ABILITY[rule.ability], rule.bonusBps ?? 0, rule.durationMs ?? 0,
    rule.equipmentDurationBps ?? 0, rule.capDelta ?? 0, rule.costDeltaBps ?? 0, rule.staminaMicro ?? 0]
}
export const PONY_RULES_HASH = keccak256(toBytes(JSON.stringify(PONY_RULES.map(ponyRuleTuple))))
