import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

test.use({ video: 'on' })

test('实际 gogo 按钮平滑右移玩家构图，限幅、回归、共用镜头且不改变规则状态', async ({ page }, testInfo) => {
  await open(page, 'mockDelay=0&seed=0x12345678')
  await enterHome(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')!
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__gogoScene = this
    }
  })
  await startRace(page)
  const gogo = page.getByTestId('gogo')
  await expect(gogo).toBeVisible()
  await expect(gogo).toBeEnabled()
  // Freeze only the driver's rule clock; still use the actual button, event queue and running Phaser renderer.
  // This isolates camera feedback from horse progress and gives exact before/after rule-state comparisons.
  await page.evaluate(() => {
    const scene = (window as any).__gogoScene
    scene.driver.update = scene.driver.update.bind(scene.driver, performance.now())
  })
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__gogoScene
    return Math.max(...scene.renderPos.map((pos: number, h: number) =>
      Math.abs(pos - scene.driver.state.horses[h].pos / 10000)))
  })).toBeLessThan(1e-8)
  const facts = () => page.evaluate(() => {
    const scene = (window as any).__gogoScene
    const player = scene.ponies[scene.driver.state.playerHorseId]
    const body = player.torso.getBounds()
    return {
      x: player.x, width: scene.scale.width, positions: scene.ponies.map((p: any) => p.x),
      left: body.left, right: body.right, track: scene.lanes[0].tilePositionX,
      rules: JSON.stringify(scene.driver.state),
      replay: JSON.stringify(scene.driver.replayInput, (_, value) => typeof value === 'bigint' ? String(value) : value),
    }
  })
  const before = await facts()
  const button = (await gogo.boundingBox())!
  await page.screenshot({ path: testInfo.outputPath('gogo-default.png') })
  await page.evaluate(() => {
    const scene = (window as any).__gogoScene
    const samples: { x: number; time: number }[] = []
    ;(window as any).__gogoSamples = samples
    const sample = () => {
      samples.push({ x: scene.ponies[scene.driver.state.playerHorseId].x, time: performance.now() })
      if (samples.length < 1500) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  for (let i = 0; i < 20; i++) {
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
    await page.waitForTimeout(100)
  }
  const pushed = await facts()
  expect(pushed.x).toBeGreaterThan(before.x + 150)
  expect(before.x / before.width).toBeCloseTo(1 / 3, 2)
  expect(pushed.x).toBeLessThanOrEqual(before.width * 2 / 3 + 1)
  expect(pushed.left).toBeGreaterThan(16)
  expect(pushed.right).toBeLessThan(before.width - 16)
  expect(pushed.track).toBeLessThan(before.track - 150)
  for (let h = 0; h < 5; h++) {
    expect(pushed.positions[h] - pushed.positions[0]).toBeCloseTo(before.positions[h] - before.positions[0], 5)
  }
  expect(pushed.rules).toBe(before.rules)
  expect(pushed.replay).toBe(before.replay)
  await page.screenshot({ path: testInfo.outputPath('gogo-pressed.png') })
  await page.waitForTimeout(7_000)
  const returned = await facts()
  expect(returned.x).toBeCloseTo(before.x, -1)
  expect(returned.rules).toBe(before.rules)
  await page.screenshot({ path: testInfo.outputPath('gogo-returned.png') })
  const samples = await page.evaluate(() => (window as any).__gogoSamples as { x: number; time: number }[])
  expect(samples.every((s) => s.x >= before.x - 1 && s.x <= before.width * 2 / 3 + 1)).toBe(true)
  // A slow continuous pan: no frame advances faster than the 0.8 s response permits.
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].time - samples[i - 1].time
    if (dt > 0) expect(Math.abs(samples[i].x - samples[i - 1].x)).toBeLessThanOrEqual(dt * .8 + 2)
  }
  await page.evaluate(() => (window as any).__gogoScene.setReducedMotion(true))
  await page.keyboard.press('Space')
  await page.waitForTimeout(250)
  expect((await facts()).x).toBeCloseTo(before.x, 2)
})
