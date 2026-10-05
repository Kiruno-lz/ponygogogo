import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { advancePonyAnimation, ponyAnimationFps } from './ponyAnimation.ts'
import { PonyPortrait } from '../ui/PonyPortrait.tsx'

test('idle holds every frame for 250ms and loops after exactly two seconds', () => {
  expect(ponyAnimationFps(true, 0)).toBe(4)
  expect(ponyAnimationFps(true, 1)).toBe(4)
  for (let frame = 0; frame < 8; frame++) {
    expect(Math.floor(advancePonyAnimation(0, frame * 250 + 249, true, 0))).toBe(frame)
  }
  expect(advancePonyAnimation(0, 2000, true, 0)).toBe(0)
})

test('full-speed running uses 12fps instead of accelerating eight poses to 28fps', () => {
  expect(ponyAnimationFps(false, 1)).toBe(12)
  expect(ponyAnimationFps(false, 0)).toBeGreaterThanOrEqual(8)
  expect(ponyAnimationFps(false, 3)).toBeLessThanOrEqual(12)
  let phase = 0
  for (let i = 0; i < 60; i++) phase = advancePonyAnimation(phase, 1000 / 60, false, 1)
  expect(phase).toBeCloseTo(4, 8)
})

test('portrait idle duration is two seconds; running keeps its separate cadence', () => {
  const idle = renderToStaticMarkup(createElement(PonyPortrait, { horseId: 5, width: 256 }))
  const running = renderToStaticMarkup(createElement(PonyPortrait, { horseId: 5, width: 256, action: 'running' }))
  expect(idle).toContain('animation-duration:2s')
  expect(running).toContain('animation-duration:0.6666666666666666s')
})
