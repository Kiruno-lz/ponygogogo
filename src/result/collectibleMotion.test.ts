import { expect, test } from 'bun:test'
import { COLLECTIBLE_SPIN, collectibleFaceFrames } from './collectibleMotion.ts'

test('through every revolution exactly the outward-facing face is painted', () => {
  const front = collectibleFaceFrames(true), back = collectibleFaceFrames(false)
  const visible = (frames: Keyframe[], progress: number) => frames.filter(frame => Number(frame.offset) <= progress).at(-1)!.visibility
  const { from, to } = COLLECTIBLE_SPIN
  for (let angle = from; angle <= to; angle += 30) {
    const cosine = Math.cos(angle * Math.PI / 180)
    if (Math.abs(cosine) < .001) continue
    const progress = (angle - from) / (to - from)
    expect(visible(front, progress)).toBe(cosine > 0 ? 'visible' : 'hidden')
    expect(visible(back, progress)).toBe(cosine > 0 ? 'hidden' : 'visible')
  }
  expect(front.at(-1)!.visibility).toBe('visible')
  expect(back.at(-1)!.visibility).toBe('hidden')
})
