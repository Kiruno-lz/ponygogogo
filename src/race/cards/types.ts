import type { EffectPayload, PrimitiveKind, StackPolicy, EffectTag } from '../core/types.ts'

export interface EffectDecl {
  primitive: PrimitiveKind
  moduleId: string
  /** null = 持续到比赛结束 */
  durationTicks: number | null
  tags: EffectTag[]
  payload: EffectPayload
}

/** Presentation data; the event solver reads numeric rules, never this object. */
export interface CardView {
  cardId: string
  /** rare 即强效果子集，参与牌堆末两张保底 */
  quality: 'common' | 'rare'
  name: { zh: string; en: string }
  desc: { zh: string; en: string }
  /** 梗源，用于卡面美术方向与图鉴 */
  meme: string
  art: { icon: string; tint?: number }
  /** 电脑马私有牌堆是否允许取到；所有卡必须显式声明 */
  cpuUsable: boolean
}

/** Identity and artwork only; gameplay fields are derived from the canonical rule table. */
export type CardMetadata = Pick<CardView, 'cardId' | 'name' | 'meme' | 'art'>

/** Legacy tick-engine declaration, isolated from event-solver card faces. */
export interface CardDef extends CardView {
  effects: EffectDecl[]
  stack?: StackPolicy
  /** 该卡依赖的模块 id，用于构建期静态检查缺模块 */
  modules: string[]
}
