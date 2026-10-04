/** Canonical paid-card data. The Solidity table is generated from this file. */
import { keccak256, toBytes } from 'viem'
import { PONY_RULES_HASH } from './ponyRules.ts'
export const CARD_EFFECT = {
  airborneSpeed: 1, speedDeath: 2, drawCut: 3, drawAuto: 4, refresh: 5,
  bomb: 6, rocket: 7, rainbow: 8, swap: 9, gravity: 10, wheel: 11, wind: 12,
  steal: 13, regen: 14, adrenaline: 15, wired: 16, fixed: 17, coat: 18,
  blindFixed: 19,
  pay: 20, phased: 21, reserve: 22, thrift: 23, rage: 24, paper: 25, ground: 26, coatGate: 27,
  recycle: 28, tinker: 29, renew: 30, unarmed: 31, target: 32, leader: 33, feast: 34,
  guard: 35, deathBurst: 36, forfeit: 37, mileage: 38,
} as const

export type PaidCardEffect = keyof typeof CARD_EFFECT
export type PaidCardBonusMode = 'follow' | 'permanent' | 'default' | 'loot'
export const CARD_MAIN_FUNCTION = { power: 0, supply: 1, equipment: 2, interference: 3, draw: 4, appearance: 5 } as const
export type CardMainFunction = keyof typeof CARD_MAIN_FUNCTION
export const PAID_CARD_GLOBALS = { bonusDefaultMs: 20_000, minCostFactorBps: 1_000, rkStepMs: 250 } as const
export type PaidCardRule = {
  id: number
  mainFunction: CardMainFunction
  effect: PaidCardEffect
  rare: boolean
  cpu: boolean
  durationMs: number | null
  bonusMode: PaidCardBonusMode
  pBps?: number
  fixedSpeed?: number
  staminaMicro?: number
  regenBonusBps?: number
  costMultiplierBps?: number
  slot?: number
  radiusMicro?: number
  strengthBps?: number
  overlapBps?: number
  periodMs?: number
  count?: number
  bonusBps?: number
  autoPanelSec?: number
  coatRgb?: number
  fallbackBps?: number
  costDeltaBps?: number
  triggerDurationMs?: number
  thresholdMicro?: number
  triggerFixedSpeed?: number
}

export const PAID_CARD_RULES: readonly PaidCardRule[] = [
  { id: 1, mainFunction: 'power', effect: 'airborneSpeed', rare: false, cpu: true, durationMs: 30_000, bonusMode: 'follow', pBps: 2_000 },
  { id: 2, mainFunction: 'power', effect: 'speedDeath', rare: true, cpu: true, durationMs: 30_000, bonusMode: 'follow', pBps: 3_000 },
  { id: 3, mainFunction: 'draw', effect: 'drawCut', rare: true, cpu: false, durationMs: 20_000, bonusMode: 'follow', pBps: 4_000 },
  { id: 4, mainFunction: 'draw', effect: 'drawAuto', rare: true, cpu: false, durationMs: null, bonusMode: 'default', bonusBps: 2_000, autoPanelSec: 3 },
  { id: 5, mainFunction: 'draw', effect: 'refresh', rare: true, cpu: false, durationMs: null, bonusMode: 'permanent', count: 1 },
  { id: 6, mainFunction: 'interference', effect: 'bomb', rare: true, cpu: true, durationMs: 0, bonusMode: 'default' },
  { id: 7, mainFunction: 'equipment', effect: 'rocket', rare: false, cpu: true, durationMs: 40_000, bonusMode: 'follow', pBps: 1_500, costMultiplierBps: 5_000, slot: 0 },
  { id: 8, mainFunction: 'equipment', effect: 'rainbow', rare: false, cpu: true, durationMs: 60_000, bonusMode: 'follow', pBps: 1_000, slot: 1 },
  { id: 9, mainFunction: 'interference', effect: 'swap', rare: true, cpu: false, durationMs: 30_000, bonusMode: 'follow', periodMs: 2_000, count: 15 },
  { id: 10, mainFunction: 'equipment', effect: 'gravity', rare: true, cpu: true, durationMs: 10_000, bonusMode: 'follow', slot: 0, radiusMicro: 8_000_000_000, strengthBps: 3_000, overlapBps: 3_000 },
  { id: 11, mainFunction: 'equipment', effect: 'wheel', rare: true, cpu: false, durationMs: 30_000, bonusMode: 'follow', slot: 2, periodMs: 7_000, count: 4, fixedSpeed: 10 },
  { id: 12, mainFunction: 'interference', effect: 'wind', rare: false, cpu: true, durationMs: null, bonusMode: 'permanent', strengthBps: 1_000 },
  { id: 13, mainFunction: 'interference', effect: 'steal', rare: true, cpu: true, durationMs: 0, bonusMode: 'loot' },
  { id: 14, mainFunction: 'supply', effect: 'regen', rare: false, cpu: true, durationMs: 5_000, bonusMode: 'follow', regenBonusBps: 10_000 },
  { id: 15, mainFunction: 'supply', effect: 'adrenaline', rare: false, cpu: true, durationMs: 0, bonusMode: 'default', staminaMicro: 200_000_000 },
  { id: 16, mainFunction: 'supply', effect: 'wired', rare: true, cpu: true, durationMs: 10_000, bonusMode: 'follow' },
  { id: 17, mainFunction: 'power', effect: 'fixed', rare: false, cpu: true, durationMs: null, bonusMode: 'permanent', fixedSpeed: 10 },
  { id: 18, mainFunction: 'power', effect: 'fixed', rare: true, cpu: true, durationMs: null, bonusMode: 'permanent', fixedSpeed: 20 },
  { id: 19, mainFunction: 'appearance', effect: 'coat', rare: false, cpu: false, durationMs: null, bonusMode: 'permanent', coatRgb: 0xf4c542 },
  { id: 20, mainFunction: 'appearance', effect: 'coat', rare: false, cpu: false, durationMs: null, bonusMode: 'permanent', coatRgb: 0x63b34a },
  { id: 21, mainFunction: 'interference', effect: 'blindFixed', rare: true, cpu: false, durationMs: null, bonusMode: 'permanent', fixedSpeed: 10 },
  { id: 22, mainFunction: 'power', effect: 'pay', rare: true, cpu: true, durationMs: 12_000, bonusMode: 'follow', pBps: 3_500, staminaMicro: 300_000_000 },
  { id: 23, mainFunction: 'supply', effect: 'phased', rare: false, cpu: true, durationMs: 24_000, bonusMode: 'follow', pBps: -1_500, regenBonusBps: 20_000, periodMs: 6_000, bonusBps: 3_000 },
  { id: 24, mainFunction: 'supply', effect: 'reserve', rare: false, cpu: true, durationMs: 20_000, bonusMode: 'follow', pBps: 500, periodMs: 10_000, staminaMicro: 300_000_000, thresholdMicro: 200_000_000 },
  { id: 25, mainFunction: 'supply', effect: 'thrift', rare: false, cpu: true, durationMs: 30_000, bonusMode: 'follow', pBps: -500, costDeltaBps: -4_000 },
  { id: 26, mainFunction: 'power', effect: 'rage', rare: true, cpu: true, durationMs: 20_000, bonusMode: 'follow', pBps: 2_500, costDeltaBps: 5_000, bonusBps: 1_000 },
  { id: 27, mainFunction: 'power', effect: 'paper', rare: false, cpu: true, durationMs: 20_000, bonusMode: 'follow', pBps: 500, bonusBps: 1_500 },
  { id: 28, mainFunction: 'power', effect: 'ground', rare: false, cpu: true, durationMs: 20_000, bonusMode: 'follow', pBps: 2_000 },
  { id: 29, mainFunction: 'appearance', effect: 'coatGate', rare: false, cpu: false, durationMs: 30_000, bonusMode: 'follow', pBps: 1_500, regenBonusBps: 15_000, fallbackBps: 500 },
  { id: 30, mainFunction: 'equipment', effect: 'recycle', rare: true, cpu: true, durationMs: 15_000, bonusMode: 'loot', pBps: 2_500, staminaMicro: 150_000_000, fallbackBps: 1_000, periodMs: 10_000 },
  { id: 31, mainFunction: 'equipment', effect: 'tinker', rare: true, cpu: true, durationMs: null, bonusMode: 'permanent', pBps: 500, periodMs: 30_000, bonusBps: 1_000, triggerDurationMs: 10_000 },
  { id: 32, mainFunction: 'equipment', effect: 'renew', rare: true, cpu: true, durationMs: 0, bonusMode: 'loot', fallbackBps: 500, periodMs: 5_000 },
  { id: 33, mainFunction: 'power', effect: 'unarmed', rare: false, cpu: true, durationMs: 30_000, bonusMode: 'follow', pBps: 2_500, fallbackBps: -500 },
  { id: 34, mainFunction: 'interference', effect: 'target', rare: true, cpu: true, durationMs: 8_000, bonusMode: 'follow', pBps: 500, fallbackBps: -2_000 },
  { id: 35, mainFunction: 'power', effect: 'leader', rare: true, cpu: true, durationMs: 8_000, bonusMode: 'follow', pBps: 2_500, fallbackBps: 800 },
  { id: 36, mainFunction: 'supply', effect: 'feast', rare: false, cpu: true, durationMs: 10_000, bonusMode: 'follow', pBps: 1_500, staminaMicro: 200_000_000 },
  { id: 37, mainFunction: 'supply', effect: 'guard', rare: true, cpu: true, durationMs: null, bonusMode: 'permanent' },
  { id: 38, mainFunction: 'power', effect: 'deathBurst', rare: true, cpu: true, durationMs: 50_000, bonusMode: 'follow', fixedSpeed: 120, triggerDurationMs: 30_000 },
  { id: 39, mainFunction: 'draw', effect: 'forfeit', rare: true, cpu: false, durationMs: null, bonusMode: 'permanent', pBps: -1_000, periodMs: 8_000, bonusBps: 2_500, triggerDurationMs: 12_000, staminaMicro: 300_000_000 },
  { id: 40, mainFunction: 'power', effect: 'mileage', rare: true, cpu: true, durationMs: null, bonusMode: 'permanent', fixedSpeed: -20, radiusMicro: 20_000_000_000, count: 4, triggerFixedSpeed: 30 },
]

export const PAID_CARD_COUNT = PAID_CARD_RULES.length

export function paidCardRule(cardId: number): PaidCardRule {
  if (!Number.isInteger(cardId) || cardId < 1 || cardId > PAID_CARD_RULES.length) throw new Error('INVALID_PAID_CARD')
  return PAID_CARD_RULES[cardId - 1]!
}

export const PAID_RARE_MASK = PAID_CARD_RULES.reduce((mask, card) => mask | (card.rare ? 1n << BigInt(card.id - 1) : 0n), 0n)
export const PAID_CPU_MASK = PAID_CARD_RULES.reduce((mask, card) => mask | (card.cpu ? 1n << BigInt(card.id - 1) : 0n), 0n)

export const CARD_BONUS_MODE = { follow: 0, permanent: 1, default: 2, loot: 3 } as const
export const PERMANENT_MS = 0xffff_ffff
export const NO_SLOT = 255

/** Fixed field order is part of the generated Solidity table and its content hash. */
export function paidCardRuleTuple(card: PaidCardRule): number[] {
  return [
    card.id, CARD_EFFECT[card.effect], card.rare ? 1 : 0, card.cpu ? 1 : 0,
    card.durationMs ?? PERMANENT_MS, CARD_BONUS_MODE[card.bonusMode], card.pBps ?? 0,
    card.fixedSpeed ?? 0, card.staminaMicro ?? 0, card.regenBonusBps ?? 0,
    card.costMultiplierBps ?? 0, card.slot ?? NO_SLOT, card.radiusMicro ?? 0,
    card.strengthBps ?? 0, card.overlapBps ?? 0, card.periodMs ?? 0,
    card.count ?? 0, card.bonusBps ?? 0, card.autoPanelSec ?? 0, card.coatRgb ?? 0,
    card.fallbackBps ?? 0, card.costDeltaBps ?? 0, card.triggerDurationMs ?? 0, card.thresholdMicro ?? 0,
    card.triggerFixedSpeed ?? 0,
  ]
}

export const PAID_CARD_RULES_HASH = keccak256(toBytes(JSON.stringify({ globals: PAID_CARD_GLOBALS,
  cards: PAID_CARD_RULES.map(paidCardRuleTuple), mainFunctions: PAID_CARD_RULES.map(c => CARD_MAIN_FUNCTION[c.mainFunction]) })))
/** New rules are immutable per solver/Game deployment; the hash changes with any card or shared numeric-rule edit. */
export const PAID_RULESET_HASH = keccak256(toBytes(`ponygogogo/paid-rules/v5/${PAID_CARD_RULES_HASH}/${PONY_RULES_HASH}`))
/** Deployed v4 sessions have no roster input and must remain replayable without initial role abilities. */
export const LEGACY_PAID_RULESET_HASH = '0x57f1149242930a98ef7819e90b5945887432efcc677578a290b19e355536af6e' as const
