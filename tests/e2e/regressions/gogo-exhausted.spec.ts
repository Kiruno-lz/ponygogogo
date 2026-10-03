import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

test('力竭时实际 gogo 按钮仍推动镜头，保留力竭提示且不改变规则状态', async ({ page }, testInfo) => {
  await open(page, 'mockDelay=0&seed=0x0000000a')
  await enterHome(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')!
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__exhaustedScene = this
    }
  })
  await startRace(page)
  const gogo = page.getByTestId('gogo')
  await expect(gogo).toBeVisible()
  // Advance the real practice driver through legal card timeouts to a solver-produced exhausted
  // snapshot, then freeze only its clock. The real HUD, pointer input and renderer keep running.
  await page.evaluate(() => {
    const driver = (window as any).__exhaustedScene.driver
    let now = performance.now()
    for (let step = 0; step < 1_000; step++) {
      driver.update(now += 250)
      if (!driver.state.pending && !driver.state.playerFinished && driver.state.effects.some(
        (effect: any) => effect.ownerHorseId === driver.state.playerHorseId && effect.payload.statusId === 'exhausted',
      )) {
        driver.update = driver.update.bind(driver, now)
        return
      }
      if (driver.state.playerFinished) break
    }
    throw new Error('Seed did not reach an actionable exhausted state')
  })
  await expect(page.getByTestId('exhausted')).toBeVisible()
  await expect(page.getByTestId('stamina-bar')).toHaveClass(/exhausted-art/)
  await expect(gogo).toBeEnabled({ timeout: 1_000 })
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__exhaustedScene
    return Math.max(...scene.renderPos.map((pos: number, h: number) =>
      Math.abs(pos - scene.driver.state.horses[h].pos / 10000)))
  })).toBeLessThan(1e-8)
  const facts = () => page.evaluate(() => {
    const scene = (window as any).__exhaustedScene
    return {
      x: scene.ponies[scene.driver.state.playerHorseId].x,
      rules: JSON.stringify(scene.driver.state),
      replay: JSON.stringify(scene.driver.replayInput, (_, value) => typeof value === 'bigint' ? String(value) : value),
    }
  })
  const before = await facts()
  await gogo.click()
  await expect.poll(async () => (await facts()).x).toBeGreaterThan(before.x + 5)
  const after = await facts()
  expect(after.rules).toBe(before.rules)
  expect(after.replay).toBe(before.replay)
  await expect(page.getByTestId('exhausted')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('gogo-exhausted-enabled.png') })
})
