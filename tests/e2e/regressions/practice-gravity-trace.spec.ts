import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

test('重力井按共享的250ms求时轨迹展示运动与装备，到期后消失', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The actual practice anchor offers C-10 in slot 2 for horse 0.
  await open(page, 'mockDelay=0&raceSpeed=6&seed=0x00000003')
  await enterHome(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')!
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__gravityScene = this
    }
  })
  await startRace(page, 0)
  const choice = page.getByTestId('card-choice-2')
  await expect(choice.locator('.card-root')).toHaveAttribute('data-card', 'C-10')
  await expect(choice).toHaveCSS('opacity', '1')
  await choice.locator('.card-root').click()
  await expect.poll(() => page.evaluate(() => (window as any).__gravityScene.ponies[0].blackhole.visible)).toBe(true)

  const facts = await page.evaluate(async () => {
    const tracePath = '/src/race/paid/trace.ts'
    const snapshotPath = '/src/race/paidSnapshot.ts'
    const { sampleHorse, tauAtWall } = await import(tracePath)
    const { demoPos, demoSpeed, demoStamina } = await import(snapshotPath)
    const scene = (window as any).__gravityScene
    const frames = new Set<string>()
    let samples = 0
    let mismatches = 0
    const end = performance.now() + 450
    while (performance.now() < end) {
      const driver = scene.driver
      const result = driver.canonicalResult()
      const tau = tauAtWall(result.trace, BigInt(Math.floor(driver.elapsedWallMs)))
      for (let h = 0; h < 5; h++) {
        const expected = sampleHorse(result.trace, h, tau)
        const actual = driver.state.horses[h]
        if (actual.pos !== demoPos(expected.pos) || actual.v !== demoSpeed(expected.v)
          || actual.stamina !== demoStamina(expected.stamina)) mismatches++
      }
      frames.add(String(scene.ponies[0].blackhole.frame.name))
      samples++
      await new Promise(requestAnimationFrame)
    }
    const result = scene.driver.canonicalResult()
    const well = result.trace.instances.find((i: any) => i.cardId === 10 && i.horse === 0 && i.kind === 'equip')
    const steps = result.trace.keyframes[0].filter((f: any) => f.tau0 >= well.startTau && f.tau0 < well.endTau)
    return {
      samples, mismatches, frames: [...frames], texture: scene.ponies[0].blackhole.texture.key,
      fullSteps: steps.filter((f: any) => BigInt(f.tau1) - BigInt(f.tau0) === 250n).length,
      maxStep: Math.max(...steps.map((f: any) => Number(f.tau1 - f.tau0))), endTau: Number(well.endTau),
    }
  })
  expect(facts.samples).toBeGreaterThan(5)
  expect(facts.mismatches).toBe(0)
  expect(facts.fullSteps).toBeGreaterThan(0)
  expect(facts.maxStep).toBe(250)
  expect(facts.frames.length).toBeGreaterThan(1)
  expect(facts.texture).toBe('fx.equipment.blackhole')
  await page.screenshot({ path: testInfo.outputPath('gravity-shared-trace.png') })
  await testInfo.attach('gravity-trace-facts', { body: JSON.stringify(facts), contentType: 'application/json' })
  await expect.poll(async () => {
    if (await page.getByTestId('card-skip').isVisible()) await page.getByTestId('card-skip').click()
    return page.evaluate((endTau) => {
      const scene = (window as any).__gravityScene
      return scene.driver.state.tick * 20 >= endTau && !scene.ponies[0].blackhole.visible
    }, facts.endTau)
  }, { timeout: 45_000 }).toBe(true)
  expect(errors).toEqual([])
})
