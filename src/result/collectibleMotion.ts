// Eight full revolutions return to the back; the last half-turn reveals the face.
export const COLLECTIBLE_SPIN = {
  from: 180,
  to: 180 + 8 * 360 + 180,
  duration: 3600,
  easing: 'cubic-bezier(0.12, 0.75, 0.18, 1)',
} as const

/** Explicit face masks share the rotor's eased progress, including all eight turns and the final reveal. */
export function collectibleFaceFrames(front: boolean): Keyframe[] {
  const { from, to } = COLLECTIBLE_SPIN
  let facingFront = false
  const frame = (offset: number): Keyframe => ({ offset, visibility: facingFront === front ? 'visible' : 'hidden', easing: 'steps(1, end)' })
  const frames = [frame(0)]
  for (let angle = from + 90; angle < to; angle += 180) {
    facingFront = !facingFront
    frames.push(frame((angle - from) / (to - from)))
  }
  frames.push(frame(1))
  return frames
}

export const COLLECTIBLE_BREATH: Keyframe[] = [
  { transform: 'scale(1)', offset: 0 },
  { transform: 'scale(1.13)', offset: .16, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  { transform: 'scale(1)', offset: 1 },
]
export const COLLECTIBLE_BREATH_MS = 1150
export const COLLECTIBLE_CONFETTI_MS = 4400

export type RibbonParticle = {
  angle: number; speed: number; drag: number; gravity: number; spin: number
  size: number; tile: number; delay: number; top: boolean
}

/** Fixed launch distribution makes production and acceptance play the same choreography. */
export function collectibleRibbons(): RibbonParticle[] {
  return Array.from({ length: 128 }, (_, i) => {
    const top = i >= 88
    const n = top ? i - 88 : i
    return {
      top,
      angle: top ? -Math.PI + .18 + (n / 39) * (Math.PI - .36) : n * Math.PI * 2 / 88,
      speed: top ? 400 + (n * 37 % 260) : 1100 + (n * 43 % 550),
      drag: top ? 1.8 : 3.2 + (n % 4) * .2,
      gravity: top ? 160 : 115,
      spin: (i % 2 ? 1 : -1) * (2 + i % 5),
      size: 16 + i * 7 % 16,
      tile: i % 16,
      delay: top ? (n % 4) * .018 : (n % 7) * .012,
    }
  })
}

export function ribbonPosition(p: RibbonParticle, seconds: number, scale: number) {
  const t = Math.max(0, seconds - p.delay)
  const drift = (1 - Math.exp(-p.drag * t)) / p.drag
  return {
    x: Math.cos(p.angle) * p.speed * drift * scale + Math.sin(t * 3 + p.tile) * t * 5 * scale,
    y: (Math.sin(p.angle) * p.speed * drift + .5 * p.gravity * t * t) * scale,
    rotation: p.spin * t,
    flutter: .35 + Math.abs(Math.cos(t * 5 + p.tile)) * .65,
    opacity: seconds < p.delay ? 0 : Math.min(1, Math.max(0, (COLLECTIBLE_CONFETTI_MS / 1000 - seconds) / 1.4)),
  }
}
