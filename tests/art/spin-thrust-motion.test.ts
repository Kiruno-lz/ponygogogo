import { expect, test } from 'bun:test'
import { helixPoint, SPIN_THRUST_ART } from '../../scripts/spin-thrust-motion.ts'

function crest(phase: number) {
  const samples = Array.from({ length: 1001 }, (_, i) => helixPoint(0.3 + i * 0.0004, phase, 1))
  return samples.reduce((peak, point) => point.y > peak.y ? point : peak)
}

test('螺旋的波峰在四分之一周期内向尾部推进，轴线与包络不漂移', () => {
  expect(crest(0).x - crest(Math.PI / 2).x).toBeCloseTo(SPIN_THRUST_ART.length / (4 * SPIN_THRUST_ART.turns), 0)
  for (let phase = 0; phase < 2 * Math.PI; phase += Math.PI / 8) {
    const front = helixPoint(1, phase, 0)
    expect(front.x).toBe(SPIN_THRUST_ART.startX + SPIN_THRUST_ART.length)
    expect(front.y).toBe(SPIN_THRUST_ART.axisY)
    const a = helixPoint(0.5, phase, 0)
    const b = helixPoint(0.5, phase, 1)
    expect(a.y + b.y).toBeCloseTo(SPIN_THRUST_ART.axisY * 2)
    expect(Math.abs(a.y - SPIN_THRUST_ART.axisY)).toBeLessThanOrEqual(SPIN_THRUST_ART.radius)
  }
})

test('旋转包含前后深度交换，旧波在尾部淡出、新波在前端长出', () => {
  expect(helixPoint(0.8, 0, 0).depth).toBeGreaterThan(helixPoint(0.8, Math.PI, 0).depth)
  expect(helixPoint(0, 0, 0).opacity).toBe(0)
  expect(helixPoint(0.04, 0, 0).opacity).toBeLessThan(helixPoint(0.3, 0, 0).opacity)
  expect(helixPoint(0.98, 0, 0).radius).toBeLessThan(helixPoint(0.75, 0, 0).radius)
  expect(helixPoint(0.98, 0, 0).radius).toBeGreaterThan(0)
})

test('帧 16 到帧 1 的相位速度连续，完整周期后的几何相同', () => {
  for (let u = 0.1; u < 0.9; u += 0.1) {
    const first = helixPoint(u, 0, 0)
    const cycle = helixPoint(u, 2 * Math.PI, 0)
    expect(cycle.y).toBeCloseTo(first.y, 10)
    expect(cycle.depth).toBeCloseTo(first.depth, 10)
    const before = helixPoint(u, -Math.PI / 8, 0)
    const last = helixPoint(u, 15 * Math.PI / 8, 0)
    expect(before.y).toBeCloseTo(last.y, 10)
    expect(before.opacity).toBeCloseTo(last.opacity, 10)
  }
})
