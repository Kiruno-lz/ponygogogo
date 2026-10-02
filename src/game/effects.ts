import type { EffectInstance } from '../race/core/types.ts'

export const EFFECT_TEXTURES = {
  rocket: {
    textureKey: 'fx.equipment.rocket',
    assetKey: 'art.effects.rocket-sheet',
    frameWidth: 288,
    frameHeight: 192,
    frameCount: 16,
    columns: 4,
    rows: 4,
  },
  rainbowTrail: {
    textureKey: 'fx.equipment.rainbow-trail',
    assetKey: 'art.effects.rainbow-trail-sheet',
    frameWidth: 288,
    frameHeight: 192,
    frameCount: 16,
    columns: 4,
    rows: 4,
  },
  blackhole: {
    textureKey: 'fx.equipment.blackhole',
    assetKey: 'art.effects.blackhole-sheet',
    frameWidth: 288,
    frameHeight: 192,
    frameCount: 16,
    columns: 4,
    rows: 4,
  },
  fireWheel: {
    textureKey: 'fx.equipment.fire-wheel',
    assetKey: 'art.effects.fire-wheel-sheet',
    frameWidth: 192,
    frameHeight: 192,
    frameCount: 16,
    columns: 4,
    rows: 4,
  },
  wind: {
    textureKey: 'fx.weather.wind',
    assetKey: 'art.effects.wind-sheet',
    frameWidth: 288,
    frameHeight: 192,
    frameCount: 16,
    columns: 4,
    rows: 4,
  },
  spinThrust: {
    textureKey: 'fx.status.spin-thrust',
    assetKey: 'art.effects.spin-thrust-sheet',
    frameWidth: 288,
    frameHeight: 192,
    frameCount: 16,
    columns: 4,
    rows: 4,
    loopMs: 650,
  },
} as const

export type EquipmentVisual = Exclude<keyof typeof EFFECT_TEXTURES, 'wind' | 'spinThrust'>

export const HEAD_COSMETIC_TEXTURES = {
  blonde: { textureKey: 'fx.head.blonde', assetKey: 'art.cosmetics.blonde-hair', originX: .66, originY: .70 },
  greenHair: { textureKey: 'fx.head.green-hair', assetKey: 'art.cosmetics.green-hair', originX: .66, originY: .70 },
} as const
export type HeadCosmetic = keyof typeof HEAD_COSMETIC_TEXTURES

export function activeHeadCosmetic(effects: readonly EffectInstance[], horseId: number): HeadCosmetic | null {
  const coat = effects.find((effect) => effect.ownerHorseId === horseId && effect.payload.statusId === 'coat')
  return coat?.sourceCardId === 'C-19' ? 'blonde' : coat?.sourceCardId === 'C-20' ? 'greenHair' : null
}

/** 分镜形变与横向流动各自计时；跟随模拟时间，使验收暂停与逐步播放可复现。 */
export function windVisualPose(direction: 1 | -1, elapsedMs: number, layer: number, width: number, reducedMotion: boolean) {
  const travel = width + 520
  const distance = (elapsedMs * (.46 + layer * .06) + layer * 610) % travel
  return {
    x: reducedMotion ? width * (layer + 1) / 4 : direction > 0 ? distance - 260 : width + 260 - distance,
    y: 410 + layer * 135,
    frame: reducedMotion ? 0 : Math.floor(elapsedMs / 180) % EFFECT_TEXTURES.wind.frameCount,
    flipX: direction < 0,
  }
}

export interface EffectPoint {
  x: number
  y: number
}

export function verticalPivotOffset(centerY: number, scaleY: number): number {
  return centerY * (1 - scaleY)
}

export function spriteAnchorOffset(
  width: number,
  height: number,
  originX: number,
  originY: number,
  pointX: number,
  pointY: number,
): EffectPoint {
  return { x: (pointX - originX) * width, y: (pointY - originY) * height }
}

export interface SpinVisualPose {
  scaleY: number
  flipY: boolean
}

export function equipmentVisual(id: string): EquipmentVisual | null {
  return EQUIPMENT_VISUALS.has(id as EquipmentVisual) ? id as EquipmentVisual : null
}

export function isSpinVisualActive(effects: readonly EffectInstance[], horseId: number): boolean {
  return effects.some(
    (effect) => effect.primitive === 'Status'
      && effect.ownerHorseId === horseId
      && effect.payload.statusId === 'luckE'
      && effect.payload.spin === true,
  )
}

/** 只用于 Phaser 表现层；固定模拟相位使不同播放速度下的动画可复现。 */
export function spinVisualPose(elapsedMs: number, reducedMotion: boolean): SpinVisualPose {
  const loopMs = EFFECT_TEXTURES.spinThrust.loopMs
  const phase = reducedMotion ? 0 : ((elapsedMs % loopMs) / loopMs) * Math.PI * 2
  const vertical = Math.cos(phase)
  return {
    scaleY: reducedMotion ? 1 : Math.max(0.12, Math.abs(vertical)),
    flipY: !reducedMotion && vertical < 0,
  }
}

/** 特效保持向前，独立于马体翻面；与马图中心及 650 ms 模拟循环对齐。 */
export function spinThrustPose(
  bodyWidth: number,
  bodyHeight: number,
  originY: number,
  elapsedMs: number,
  reducedMotion: boolean,
): EffectPoint & { width: number; height: number; frame: number } {
  const spec = EFFECT_TEXTURES.spinThrust
  const width = bodyWidth * 1.4
  return {
    x: 0,
    y: (0.5 - originY) * bodyHeight,
    width,
    height: width * spec.frameHeight / spec.frameWidth,
    frame: reducedMotion ? 0 : Math.floor(((elapsedMs % spec.loopMs) / spec.loopMs) * spec.frameCount),
  }
}

export interface TransferPose extends EffectPoint {
  done: boolean
}

/** 装备沿屏幕坐标中的短弧线转移；不修改规则快照。 */
export function equipmentTransferPose(
  from: EffectPoint,
  to: EffectPoint,
  progress: number,
  reducedMotion: boolean,
): TransferPose {
  const p = Math.max(0, Math.min(1, progress))
  if (reducedMotion) return { ...to, done: true }
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p - Math.sin(Math.PI * p) * 30,
    done: p >= 1,
  }
}

const EQUIPMENT_VISUALS = new Set<EquipmentVisual>(['rocket', 'rainbowTrail', 'blackhole', 'fireWheel'])

export function activeEquipmentVisuals(effects: readonly EffectInstance[], horseId: number): EquipmentVisual[] {
  const active: EquipmentVisual[] = []
  const seen = new Set<EquipmentVisual>()
  for (const effect of effects) {
    if (effect.primitive !== 'Equipment' || effect.ownerHorseId !== horseId) continue
    const equipId = effect.payload.equipId as EquipmentVisual | undefined
    if (!equipId || !EQUIPMENT_VISUALS.has(equipId) || seen.has(equipId)) continue
    seen.add(equipId)
    active.push(equipId)
  }
  return active
}

export function activeWindDirection(effects: readonly EffectInstance[]): 1 | -1 | null {
  const wind = effects.find(
    (effect) => effect.primitive === 'Environment'
      && effect.ownerHorseId === -1
      && effect.payload.envKind === 'wind',
  )
  return wind ? (wind.payload.windDir === -1 ? -1 : 1) : null
}
