import { expect, test, type Page } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

test.use({ video: 'on' })

async function openSpinScene(page: Page) {
  await open(page, 'mockDelay=0')
  await enterHome(page)
  // Capture the real production scene, without adding a debugging API to the app.
  await page.evaluate(async () => {
    // Vite can attach an HMR timestamp; import the exact module already used by the app.
    const modulePath = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')
    if (!modulePath) throw new Error('The production RaceScene module was not loaded')
    const { RaceScene } = await import(modulePath)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__spinScene = this
    }
  })
  await page.getByRole('button', { name: '特效验收' }).click()
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__spinScene?.ponies.length))).toBe(true)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.evaluate(() => {
    const driver = (window as any).__spinScene.driver
    driver.restart()
    driver.pause()
  })
  await page.waitForTimeout(100)
}

async function facts(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).__spinScene
    return scene.ponies.map((pony: any) => {
      const fx = pony.spinThrust
      const body = pony.torso
      const center = body.getWorldTransformMatrix().transformPoint(
        (0.5 - body.originX) * body.width, (0.5 - body.originY) * body.height)
      const anchor = fx?.getWorldTransformMatrix().transformPoint(0, 0)
      return {
        exists: Boolean(fx), visible: fx?.visible, frame: fx?.frame.name,
        frameCount: fx ? scene.textures.get(fx.texture.key).frameTotal - 1 : 0,
        x: pony.x, centerY: center.y,
        anchorError: anchor ? Math.hypot(anchor.x - center.x, anchor.y - center.y) : null,
        facingRight: fx ? fx.scaleX > 0 && fx.scaleY > 0 : false,
        behindBody: fx ? pony.list.indexOf(fx) < pony.list.indexOf(pony.root) : false,
        opacity: fx?.alpha,
        relativeWidth: fx ? fx.displayWidth / body.displayWidth : 0,
        relativeHeight: fx ? fx.displayHeight / body.displayHeight : 0,
        bodyScaleY: pony.root.scaleY,
      }
    })
  })
}

test('C-02 分镜随归属、移动、起飞和中心翻面正确绑定，并在暂停、静态模式和到期时保持正确状态', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openSpinScene(page)
  const initial = await facts(page)
  expect(initial[0].exists).toBe(true)
  expect(initial.map((pony: any) => pony.visible)).toEqual([true, false, false, false, false])
  expect(initial[0].frameCount).toBe(16)
  expect(initial[0].anchorError).toBeLessThan(0.01)
  expect(initial[0].relativeWidth).toBeCloseTo(1.4)
  expect(initial[0].relativeHeight).toBeGreaterThan(1.2)
  expect(initial[0].behindBody).toBe(false)
  expect(initial[0].opacity).toBeGreaterThan(0.4)
  expect(initial[0].opacity).toBeLessThan(0.65)
  await page.screenshot({ path: testInfo.outputPath('spin-thrust-bound.png') })

  const pausedFrame = initial[0].frame
  await page.waitForTimeout(150)
  expect((await facts(page))[0].frame).toBe(pausedFrame)
  const frames = new Set<number>([pausedFrame])
  for (let phase = 0; phase < 4; phase++) {
    await page.getByRole('button', { name: '前进 100 ms' }).click()
    await page.waitForTimeout(80)
    const now = (await facts(page))[0]
    frames.add(now.frame)
    expect(now.anchorError).toBeLessThan(0.01)
    expect(now.facingRight).toBe(true)
  }
  expect(frames.size).toBeGreaterThan(2)
  expect((await facts(page))[0].x).not.toBe(initial[0].x)
  expect((await facts(page))[0].bodyScaleY).toBeLessThan(0)

  // Combine C-02 with airborne in the same live scene while the driver is paused.
  await page.evaluate(() => {
    const scene = (window as any).__spinScene
    scene.driver.state.effects.push({
      instanceId: 999, sourceCardId: 'C-01', primitive: 'Status', ownerHorseId: 0,
      moduleId: 'mod.airborne', appliedAtTick: 0, durationTicks: 1500, tags: ['buff'],
      payload: { statusId: 'airborne' },
    })
  })
  await page.waitForTimeout(600)
  const flying = (await facts(page))[0]
  expect(flying.centerY).toBeLessThan(initial[0].centerY - 35)
  expect(flying.anchorError).toBeLessThan(0.01)
  expect(flying.facingRight).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('spin-thrust-airborne.png') })

  const reduced = page.getByRole('checkbox', { name: '减少动态效果' })
  await reduced.check()
  await page.waitForTimeout(120)
  const still = (await facts(page))[0]
  expect(still.frame).toBe(0)
  expect(still.bodyScaleY).toBe(1)
  expect(still.anchorError).toBeLessThan(0.01)
  await page.screenshot({ path: testInfo.outputPath('spin-thrust-reduced.png') })
  await reduced.uncheck()

  await page.evaluate(() => {
    const scene = (window as any).__spinScene
    for (const effect of scene.driver.state.effects) effect.ownerHorseId = 1
  })
  await page.waitForTimeout(120)
  const moved = await facts(page)
  expect(moved.map((pony: any) => pony.visible)).toEqual([false, true, false, false, false])
  expect(moved[1].anchorError).toBeLessThan(0.01)
  expect(moved[1].relativeWidth).toBeCloseTo(1.4)
  await testInfo.attach('binding-facts', {
    body: JSON.stringify({ initial, flying, reduced: still, changedOwner: moved }, null, 2),
    contentType: 'application/json',
  })

  await page.getByRole('button', { name: '重播', exact: true }).click()
  await page.waitForTimeout(6_300)
  expect((await facts(page)).every((pony: any) => !pony.visible)).toBe(true)
  await page.getByRole('combobox', { name: '展示情景' }).selectOption('C-07')
  await page.waitForTimeout(250)
  expect((await facts(page)).every((pony: any) => !pony.visible)).toBe(true)
  expect(errors).toEqual([])
})
