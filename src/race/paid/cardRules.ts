/** Canonical paid-card data. The Solidity table is generated from this file. */
import { keccak256, toBytes } from 'viem'
export const CARD_EFFECT = {
  none: 0, airborneSpeed: 1, speedDeath: 2, drawCut: 3, drawAuto: 4, refresh: 5,
  bomb: 6, rocket: 7, rainbow: 8, swap: 9, gravity: 10, wheel: 11, wind: 12,
  steal: 13, regen: 14, adrenaline: 15, wired: 16, fixed: 17, coat: 18,
  blindFixed: 19,
} as const

export type PaidCardEffect = keyof typeof CARD_EFFECT
export type PaidCardBonusMode = 'follow' | 'permanent' | 'default' | 'loot'
export const PAID_CARD_GLOBALS = { bonusDefaultMs: 20_000 } as const
export type PaidCardRule = {
  id: number
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
}

export const PAID_CARD_RULES: readonly PaidCardRule[] = [
  { id: 1, effect: 'airborneSpeed', rare: false, cpu: true, durationMs: 30_000, bonusMode: 'follow', pBps: 2_000 },
  { id: 2, effect: 'speedDeath', rare: true, cpu: true, durationMs: 30_000, bonusMode: 'follow', pBps: 3_000 },
  { id: 3, effect: 'drawCut', rare: true, cpu: false, durationMs: 20_000, bonusMode: 'follow', pBps: 4_000 },
  { id: 4, effect: 'drawAuto', rare: true, cpu: false, durationMs: null, bonusMode: 'default', bonusBps: 2_000, autoPanelSec: 3 },
  { id: 5, effect: 'refresh', rare: true, cpu: false, durationMs: null, bonusMode: 'permanent', count: 1 },
  { id: 6, effect: 'bomb', rare: true, cpu: true, durationMs: 0, bonusMode: 'default' },
  { id: 7, effect: 'rocket', rare: false, cpu: true, durationMs: 40_000, bonusMode: 'follow', pBps: 1_500, costMultiplierBps: 5_000, slot: 0 },
  { id: 8, effect: 'rainbow', rare: false, cpu: true, durationMs: 60_000, bonusMode: 'follow', pBps: 1_000, slot: 1 },
  { id: 9, effect: 'swap', rare: true, cpu: false, durationMs: 30_000, bonusMode: 'follow', periodMs: 2_000, count: 15 },
  { id: 10, effect: 'gravity', rare: true, cpu: true, durationMs: 10_000, bonusMode: 'follow', slot: 0, radiusMicro: 8_000_000_000, strengthBps: 6_000, overlapBps: 6_000 },
  { id: 11, effect: 'wheel', rare: true, cpu: false, durationMs: 30_000, bonusMode: 'follow', slot: 2, periodMs: 7_000, count: 4, fixedSpeed: 10 },
  { id: 12, effect: 'wind', rare: false, cpu: true, durationMs: null, bonusMode: 'permanent', strengthBps: 1_000 },
  { id: 13, effect: 'steal', rare: true, cpu: true, durationMs: 0, bonusMode: 'loot' },
  { id: 14, effect: 'regen', rare: false, cpu: true, durationMs: 5_000, bonusMode: 'follow', regenBonusBps: 10_000 },
  { id: 15, effect: 'adrenaline', rare: false, cpu: true, durationMs: 0, bonusMode: 'default', staminaMicro: 200_000_000 },
  { id: 16, effect: 'wired', rare: true, cpu: true, durationMs: 10_000, bonusMode: 'follow' },
  { id: 17, effect: 'fixed', rare: false, cpu: true, durationMs: null, bonusMode: 'permanent', fixedSpeed: 10 },
  { id: 18, effect: 'fixed', rare: true, cpu: true, durationMs: null, bonusMode: 'permanent', fixedSpeed: 20 },
  { id: 19, effect: 'coat', rare: false, cpu: false, durationMs: null, bonusMode: 'permanent', coatRgb: 0xf4c542 },
  { id: 20, effect: 'coat', rare: false, cpu: false, durationMs: null, bonusMode: 'permanent', coatRgb: 0x63b34a },
  { id: 21, effect: 'blindFixed', rare: true, cpu: false, durationMs: null, bonusMode: 'permanent', fixedSpeed: 10 },
  { id: 22, effect: 'none', rare: false, cpu: false, durationMs: 0, bonusMode: 'default' },
  { id: 23, effect: 'none', rare: false, cpu: false, durationMs: 0, bonusMode: 'default' },
  { id: 24, effect: 'none', rare: false, cpu: false, durationMs: 0, bonusMode: 'default' },
  { id: 25, effect: 'none', rare: false, cpu: false, durationMs: 0, bonusMode: 'default' },
  { id: 26, effect: 'none', rare: false, cpu: false, durationMs: 0, bonusMode: 'default' },
]

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
  ]
}

export const PAID_CARD_RULES_HASH = keccak256(toBytes(JSON.stringify({ globals: PAID_CARD_GLOBALS, cards: PAID_CARD_RULES.map(paidCardRuleTuple) })))
/** New rules are immutable per solver/Game deployment; the hash changes with any card-table edit. */
export const PAID_RULESET_HASH = keccak256(toBytes(`ponygogogo/paid-rules/v3/${PAID_CARD_RULES_HASH}`))
