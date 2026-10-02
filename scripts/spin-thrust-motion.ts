import { EFFECT_TEXTURES } from '../src/game/effects.ts'

/** Authoring coordinates for the C-02 frame. Runtime only reads the baked atlas. */
export const SPIN_THRUST_ART = {
  frameWidth: EFFECT_TEXTURES.spinThrust.frameWidth, frameHeight: EFFECT_TEXTURES.spinThrust.frameHeight,
  frameCount: EFFECT_TEXTURES.spinThrust.frameCount, loopMs: EFFECT_TEXTURES.spinThrust.loopMs,
  startX: 16, length: 256, axisY: 96, radius: 66, turns: 1.25,
} as const

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

export function helixPoint(u: number, phase: number, strand: 0 | 1) {
  const art = SPIN_THRUST_ART
  const angle = u * art.turns * Math.PI * 2 + phase + strand * Math.PI
  const radius = art.radius * smooth((1 - u) / 0.15)
  const depth = Math.cos(angle)
  return {
    x: art.startX + u * art.length,
    y: art.axisY + Math.sin(angle) * radius,
    radius, depth,
    opacity: smooth(u / 0.12) * smooth((1 - u) / 0.07) * (0.4 + (depth + 1) * 0.3),
    thickness: 28 + (depth + 1) * 3,
  }
}
