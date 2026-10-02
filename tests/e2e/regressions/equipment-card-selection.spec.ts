import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

test('C-08 的彩虹发射端贴合尾根，并随马匹尺寸、起飞、翻面和归属移动', async ({ page }, testInfo) => {
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')!
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__tailScene = this
    }
  })
  await page.getByRole('button', { name: '特效验收' }).click()
  await page.getByRole('combobox', { name: '展示情景' }).selectOption('C-08')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__tailScene?.ponies.length))).toBe(true)

  const facts = () => page.evaluate(() => {
    const scene = (window as any).__tailScene
    return scene.ponies.map((pony: any) => {
      const body = pony.torso
      const fx = pony.rainbowTrail
      // Tail root in the normalized horse art; rainbow emitter is its right-hand tip.
      const tail = body.getWorldTransformMatrix().transformPoint(
        (.30 - body.originX) * body.width, (.55 - body.originY) * body.height)
      const tip = fx.getWorldTransformMatrix().transformPoint(
        (.99 - fx.originX) * fx.width, (.54 - fx.originY) * fx.height)
      return {
        visible: fx.visible, tailY: tail.y, error: Math.hypot(tip.x - tail.x, tip.y - tail.y),
        bodyScaleY: pony.root.scaleY,
        followsBody: fx.parentContainer === body.parentContainer,
        behindBody: pony.root.list.indexOf(fx) < pony.root.list.indexOf(body),
      }
    })
  })
  await page.waitForTimeout(120)
  const initial = await facts()
  await page.screenshot({ path: testInfo.outputPath('rainbow-tail.png') })
  expect(initial.map((p: any) => p.visible)).toEqual([true, false, false, false, false])
  for (const pony of initial) {
    expect(pony.error).toBeLessThan(3)
    expect(pony.followsBody && pony.behindBody).toBe(true)
  }
  await page.evaluate(() => {
    const scene = (window as any).__tailScene
    scene.driver.state.effects.push({ instanceId: 999, sourceCardId: 'C-01', primitive: 'Status',
      ownerHorseId: 0, moduleId: 'mod.airborne', appliedAtTick: 0, durationTicks: 1500,
      tags: ['buff'], payload: { statusId: 'airborne' } })
  })
  await page.waitForTimeout(600)
  const flying = await facts()
  expect(flying[0].tailY).toBeLessThan(initial[0].tailY - 35)
  expect(flying[0].error).toBeLessThan(3)
  await page.evaluate(() => {
    const scene = (window as any).__tailScene
    scene.driver.state.tick = 16
    scene.driver.state.effects.push({ instanceId: 1000, sourceCardId: 'C-02', primitive: 'Status',
      ownerHorseId: 0, moduleId: 'mod.speed', appliedAtTick: 0, durationTicks: 1500,
      tags: ['buff'], payload: { statusId: 'luckE', spin: true } })
  })
  await page.waitForTimeout(120)
  const flipped = (await facts())[0]
  expect(flipped.bodyScaleY).toBeLessThan(0)
  expect(flipped.error).toBeLessThan(3)
  await page.getByRole('checkbox', { name: '减少动态效果' }).check()
  await page.waitForTimeout(120)
  expect((await facts())[0].bodyScaleY).toBe(1)
  expect((await facts())[0].error).toBeLessThan(3)
  await page.evaluate(() => {
    const scene = (window as any).__tailScene
    scene.driver.state.effects.find((fx: any) => fx.payload.equipId === 'rainbowTrail').ownerHorseId = 1
  })
  await page.waitForTimeout(120)
  const moved = await facts()
  expect(moved.map((p: any) => p.visible)).toEqual([false, true, false, false, false])
  for (const pony of moved) expect(pony.error).toBeLessThan(3)
  await page.screenshot({ path: testInfo.outputPath('rainbow-transferred.png') })
})
