import { expect, test } from 'bun:test'
import { GogoCameraMotion } from './gogoCamera.ts'

test('空闲不偏移，单次点击不跳变，连点后逐渐推进并回到原点', () => {
  const camera = new GogoCameraMotion()
  camera.update(5000)
  expect(camera.offsetRatio).toBe(0)
  camera.press()
  expect(camera.offsetRatio).toBe(0)
  camera.update(16)
  expect(camera.offsetRatio).toBeGreaterThan(0)
  expect(camera.offsetRatio).toBeLessThan(.01)
  for (let i = 0; i < 20; i++) { camera.press(); camera.update(100) }
  expect(camera.offsetRatio).toBeGreaterThan(.6)
  camera.update(7000)
  expect(camera.offsetRatio).toBeLessThan(.01)
})

test('密集输入受上限约束，较低点击频率产生较少偏移', () => {
  const rapid = new GogoCameraMotion(), slow = new GogoCameraMotion()
  for (let t = 0; t < 5000; t += 20) {
    rapid.press()
    if (t % 500 === 0) slow.press()
    rapid.update(20); slow.update(20)
    expect(rapid.offsetRatio).toBeGreaterThanOrEqual(0)
    expect(rapid.offsetRatio).toBeLessThanOrEqual(1)
  }
  expect(rapid.offsetRatio).toBeGreaterThan(slow.offsetRatio + .3)
})

test('相同点击时刻在不同帧率下具有相同镜头状态', () => {
  const at = (fps: number) => {
    const camera = new GogoCameraMotion()
    for (let click = 0; click < 8; click++) {
      camera.press()
      let remaining = 250
      while (remaining > 0) {
        const dt = Math.min(1000 / fps, remaining)
        camera.update(dt)
        remaining -= dt
      }
    }
    return camera.offsetRatio
  }
  expect(at(30)).toBeCloseTo(at(144), 10)
})

test('减少动态效果时可直接清空镜头反馈状态', () => {
  const camera = new GogoCameraMotion()
  camera.press(); camera.update(500)
  expect(camera.offsetRatio).toBeGreaterThan(0)
  camera.reset()
  camera.update(500)
  expect(camera.offsetRatio).toBe(0)
})
