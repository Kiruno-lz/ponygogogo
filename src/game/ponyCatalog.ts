import { HORSE_PROFILES, makeHorseProfile, type HorseProfile } from './horses.ts'
export { DEFAULT_ROSTER, normalizeRoster, ponyIdAt, type PonyRoster } from '../race/core/roster.ts'
type Point = readonly [number, number]
export type PonyRenderSpec = {
  scale: number
  shadowWidth: number
  groundOrigin: number
  head: Point
  belly: Point
  tail: Point
  feet: readonly Point[]
  resultFooting: { centerX: number; bottom: number }
  posterFootings: { rear: Point; front: Point }
  posterScale?: number
}
export interface PonyDefinition extends HorseProfile {
  ponyId: number
  defaultOpen: boolean
  locomotion: 'quadruped' | 'biped'
  renderSpec: PonyRenderSpec
}

const fourFeet: readonly Point[] = [[-48, -12], [48, -12], [-66, -8], [68, -8]]
const legacyRenderAnchors = { head: [.73,.34] as Point, belly: [.44,.68] as Point, tail: [.3,.55] as Point, feet: fourFeet }
// Normalized sprite anchors and wheel centers measured from the shipped idle frames.
const newRenderAnchors: Record<number, { head: Point; belly: Point; tail: Point; feet: readonly Point[] }> = {
  5: { head: [.75,.30], belly: [.52,.68], tail: [.31,.64], feet: [[2,-10],[55,-10],[-34.5,-8],[26,-8]] },
  6: { head: [.78,.29], belly: [.46,.70], tail: [.30,.56], feet: [[-25,-10],[38,-10],[-47,-8],[20,-8]] },
  7: { head: [.75,.30], belly: [.60,.68], tail: [.30,.60], feet: [[-7,-10],[64.5,-10],[-37.5,-8],[32,-8]] },
  8: { head: [.56,.30], belly: [.54,.72], tail: [.31,.76], feet: [[-20,-8],[20,-8]] },
}
const resultFootings = [
  { centerX: 247, bottom: 379 }, { centerX: 263, bottom: 382 }, { centerX: 259, bottom: 376 },
  { centerX: 262, bottom: 380 }, { centerX: 260, bottom: 378 },
  ...Array.from({ length: 4 }, () => ({ centerX: 257.5, bottom: 368 })),
]
// Measured foot contacts in the dedicated share masters, in source pixels.
const posterFootings: readonly { rear: Point; front: Point }[] = [
  { rear: [286,694], front: [815,717] }, { rear: [269,826], front: [898,838] },
  { rear: [280,723], front: [833,740] }, { rear: [267,738], front: [786,745] },
  { rear: [308,793], front: [908,818] }, { rear: [192,524], front: [641,526] },
  { rear: [200.5,534], front: [561.5,529] }, { rear: [190,519], front: [673.5,524] },
  { rear: [337,539], front: [472,532] },
]
function definition(profile: HorseProfile, defaultOpen: boolean, biped = false): PonyDefinition {
  return { ...profile, ponyId: profile.horseId, defaultOpen, locomotion: biped ? 'biped' : 'quadruped',
    renderSpec: { scale: profile.horseId === 0 ? .85 : .75, shadowWidth: biped ? 90 : 136, groundOrigin: 180 / 192,
      ...(newRenderAnchors[profile.horseId] ?? legacyRenderAnchors),
      resultFooting: resultFootings[profile.horseId]!, posterFootings: posterFootings[profile.horseId]!,
      ...(biped ? { posterScale: .8 } : {}) } }
}

export const PONY_CATALOG: readonly PonyDefinition[] = [
  ...HORSE_PROFILES.map(p => definition(p, true)),
  definition(makeHorseProfile(5, '牛来', 'Niulai', 0xf3c33d, 0x615665), false),
  definition(makeHorseProfile(6, '啥马', 'Shama', 0xd6d1be, 0x292921), false),
  definition(makeHorseProfile(7, '奶龙', 'Nailong', 0xf9d02f, 0x513b25), false),
  definition(makeHorseProfile(8, '咕咕嘎嘎', 'Gugu Gaga', 0x424550, 0xe9c638), false, true),
]

export function ponyById(ponyId: number): PonyDefinition {
  const pony = PONY_CATALOG.find(p => p.ponyId === ponyId)
  if (!pony) throw new Error('INVALID_PONY')
  return pony
}
