import type { EffectPayload, PrimitiveKind, StackPolicy, EffectTag } from '../core/types.ts'

export interface EffectDecl {
  primitive: PrimitiveKind
  moduleId: string
  /** null = 持续到比赛结束 */
  durationTicks: number | null
  tags: EffectTag[]
  payload: EffectPayload
}

export interface CardDef {
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
  effects: EffectDecl[]
  stack?: StackPolicy
  /** 该卡依赖的模块 id，用于构建期静态检查缺模块 */
  modules: string[]
}
