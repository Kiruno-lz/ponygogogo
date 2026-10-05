export const PONY_FRAME_COUNT = 8
export const PONY_IDLE_FPS = 4
export const PONY_RUNNING_FPS = 12

export function ponyAnimationFps(stopped: boolean, speedRatio: number): number {
  return stopped ? PONY_IDLE_FPS : 8 + (PONY_RUNNING_FPS - 8) * Math.max(0, Math.min(1, speedRatio))
}

export function advancePonyAnimation(phase: number, dtMs: number, stopped: boolean, speedRatio: number): number {
  return (phase + dtMs * ponyAnimationFps(stopped, speedRatio) / 1000) % PONY_FRAME_COUNT
}
