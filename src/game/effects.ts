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
} as const

export type EquipmentVisual = Exclude<keyof typeof EFFECT_TEXTURES, 'wind'>

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
