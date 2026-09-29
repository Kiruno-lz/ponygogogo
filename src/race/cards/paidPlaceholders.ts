import type { CardDef } from './types.ts'
import { CARD_POOL } from './pool.ts'

/** Paid-only common slots. They have no rule effect until a new ruleset defines one. */
export const PAID_PLACEHOLDER_CARDS: CardDef[] = [22, 23, 24, 25, 26].map((id, index) => ({
  cardId: `C-${id}`,
  quality: 'common',
  name: { zh: `普通卡占位 ${index + 1}`, en: `Common Card ${index + 1}` },
  desc: { zh: '本卡没有数值效果。', en: 'This card has no rule effect.' },
  meme: '—',
  art: { icon: 'icon_13' },
  cpuUsable: false,
  effects: [],
  modules: [],
}))

export const PAID_CARD_POOL: readonly CardDef[] = [...CARD_POOL, ...PAID_PLACEHOLDER_CARDS]
