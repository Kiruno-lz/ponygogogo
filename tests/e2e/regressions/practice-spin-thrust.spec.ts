import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

test('真实免费试玩取得 C-02 后显示玩家翻面与螺旋分镜，到期后消失', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // RaceDriver's real practice.open anchor derives C-02 as the first candidate for horse 0.
  await open(page, 'mockDelay=0&raceSpeed=6&seed=0x00000033')
  await enterHome(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')
    if (!path) throw new Error('RaceScene was not loaded')
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__practiceSpinScene = this
    }
  })
  await startRace(page, 0)
  await expect(page.getByTestId('card-panel')).toBeVisible()
  const card = page.getByTestId('card-choice-0').locator('.card-root')
  await expect(card).toHaveAttribute('data-card', 'C-02')
  expect(await page.evaluate(() => (window as any).__practiceSpinScene.ponies[0].spinThrust.visible)).toBe(false)
  await card.click()
  await expect(page.getByTestId('buff-C-02')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__practiceSpinScene
    const pony = scene.ponies[scene.driver.state.playerHorseId]
    return pony.visible && pony.spinThrust.visible
  })).toBe(true)

  // Read actual rendering across frames; never inject effects or advance the driver manually.
  const facts = await page.evaluate(async () => {
    const scene = (window as any).__practiceSpinScene
    const frames = new Set<number>()
    let flipped = false
    const end = performance.now() + 600
    while (performance.now() < end) {
      const pony = scene.ponies[scene.driver.state.playerHorseId]
      frames.add(pony.spinThrust.frame.name)
      flipped ||= pony.root.scaleY < 0
      await new Promise(requestAnimationFrame)
    }
    const state = scene.driver.state
    const pony = scene.ponies[state.playerHorseId]
    const effects = state.effects.filter((e: any) => e.ownerHorseId === state.playerHorseId && e.sourceCardId === 'C-02')
    const effect = effects[0]
    return {
      stakeTier: state.stakeTier, frames: [...frames], flipped,
      texture: pony.spinThrust.texture.key,
      frameCount: scene.textures.get(pony.spinThrust.texture.key).frameTotal - 1,
      effects: effects.length, tags: effect.tags, payload: effect.payload,
      endTick: effect.appliedAtTick + effect.durationTicks,
    }
  })
  expect(facts.stakeTier).toBe(0)
  expect(facts.texture).toBe('fx.status.spin-thrust')
  expect(facts.frameCount).toBe(16)
  expect(facts.frames.length).toBeGreaterThan(2)
  expect(facts.flipped).toBe(true)
  expect(facts.effects).toBe(1)
  expect(facts.tags).toEqual(['buff', 'debuff'])
  expect(facts.payload).toEqual({ statusId: 'luckE', spin: true })
  await page.screenshot({ path: testInfo.outputPath('practice-spin-thrust.png') })
  await testInfo.attach('real-race-spin-facts', { body: JSON.stringify(facts), contentType: 'application/json' })

  await expect.poll(async () => {
    const skip = page.getByTestId('card-skip')
    if (await skip.isVisible()) await skip.click()
    return page.evaluate((endTick) => {
      const scene = (window as any).__practiceSpinScene
      return scene.driver.state.tick >= endTick && !scene.ponies[0].spinThrust.visible
    }, facts.endTick)
  }, { timeout: 45_000 }).toBe(true)
  await expect(page.getByTestId('buff-C-02')).toHaveCount(0)
  expect(errors).toEqual([])
})
