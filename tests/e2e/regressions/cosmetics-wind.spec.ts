import { expect, test, type Page } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

async function showcase(page: Page, cardId: string) {
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')!
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__cosmeticScene = this
    }
  })
  await page.getByRole('button', { name: '特效验收' }).click()
  await page.getByRole('combobox', { name: '展示情景' }).selectOption(cardId)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.waitForTimeout(150)
}

test('C-19/C-20 在五种马色上显示独立头饰，替换、起飞和翻面仍贴合头部', async ({ page }, testInfo) => {
  await showcase(page, 'C-19')
  const facts = () => page.evaluate(() => (window as any).__cosmeticScene.ponies.map((pony: any) => {
    const body = pony.torso
    const item = pony.headAccessory
    return {
      exists: Boolean(item), visible: item?.visible, key: item?.texture.key,
      bodyTinted: body.isTinted, itemTinted: item?.isTinted,
      attached: item?.parentContainer === body.parentContainer,
      inFront: item ? pony.root.list.indexOf(item) > pony.root.list.indexOf(body) : false,
      y: item?.getWorldTransformMatrix().transformPoint(0, 0).y,
      bodyScaleY: pony.root.scaleY,
      origin: item ? [item.originX, item.originY] : null,
    }
  }))
  expect((await facts())[0].exists).toBe(true)
  for (const [card, key] of [['C-19', 'fx.head.blonde'], ['C-20', 'fx.head.green-hair']] as const) {
    if (card === 'C-20') {
      await page.getByRole('combobox', { name: '展示情景' }).selectOption(card)
      await page.getByRole('button', { name: '暂停', exact: true }).click()
    }
    await page.evaluate(() => {
      const state = (window as any).__cosmeticScene.driver.state
      const coat = state.effects.find((fx: any) => fx.payload.statusId === 'coat')
      state.effects = [0, 1, 2, 3, 4].map((ownerHorseId) => ({ ...coat, ownerHorseId, instanceId: ownerHorseId + 1 }))
    })
    await page.waitForTimeout(150)
    const all = await facts()
    for (const pony of all) {
      expect(pony.visible).toBe(true)
      expect(pony.key).toBe(key)
      expect(pony.bodyTinted || pony.itemTinted).toBe(false)
      expect(pony.attached && pony.inFront).toBe(true)
      expect(pony.origin).toEqual([.66, .70])
    }
    await page.screenshot({ path: testInfo.outputPath(`${card}-all-coats.png`) })
  }
  const before = (await facts())[0].y
  await page.evaluate(() => {
    const state = (window as any).__cosmeticScene.driver.state
    state.effects.push({ instanceId: 999, sourceCardId: 'C-01', primitive: 'Status',
      moduleId: 'mod.airborne', ownerHorseId: 0, appliedAtTick: 0, durationTicks: null,
      tags: ['buff'], payload: { statusId: 'airborne' } })
  })
  await page.waitForTimeout(600)
  expect((await facts())[0].y).toBeLessThan(before - 35)
  await page.evaluate(() => {
    const state = (window as any).__cosmeticScene.driver.state
    state.tick = 16
    state.effects.push({ instanceId: 1000, sourceCardId: 'C-02', primitive: 'Status',
      moduleId: 'mod.speed', ownerHorseId: 0, appliedAtTick: 0, durationTicks: null,
      tags: ['buff'], payload: { statusId: 'luckE', spin: true } })
  })
  await page.waitForTimeout(100)
  expect((await facts())[0].bodyScaleY).toBeLessThan(0)
  expect((await facts())[0].attached).toBe(true)
  await page.evaluate(() => {
    const state = (window as any).__cosmeticScene.driver.state
    state.effects = state.effects.filter((fx: any) => fx.payload.statusId !== 'coat')
  })
  await page.waitForTimeout(100)
  expect((await facts()).every((pony: any) => !pony.visible && !pony.bodyTinted)).toBe(true)
})

test('C-12 分镜放慢、顺逆风明显向相反方向移动，暂停与减少动态效果均稳定', async ({ page }, testInfo) => {
  await showcase(page, 'C-12')
  const direction = page.getByRole('combobox', { name: '风向' })
  expect(await direction.count()).toBe(1)
  const facts = () => page.evaluate(() => (window as any).__cosmeticScene.windSprites
    .map((sprite: any) => ({ x: sprite.x, frame: sprite.frame.name, flipX: sprite.flipX, visible: sprite.visible })))
  const initial = await facts()
  await page.waitForTimeout(250)
  expect(await facts()).toEqual(initial)
  await page.evaluate(() => (window as any).__cosmeticScene.driver.step(500))
  await page.waitForTimeout(60)
  const forward = await facts()
  expect(forward[0].x - initial[0].x).toBeGreaterThan(180)
  expect(forward[0].x - initial[0].x).toBeLessThan(320)
  expect((forward[0].frame - initial[0].frame + 16) % 16).toBeLessThanOrEqual(3)
  expect(forward.every((s: any) => s.visible && !s.flipX)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('wind-forward.png') })
  await direction.selectOption('-1')
  await page.waitForTimeout(60)
  const backward = await facts()
  expect(backward.every((s: any) => s.flipX)).toBe(true)
  await page.evaluate(() => {
    const scene = (window as any).__cosmeticScene
    scene.driver.step(500)
  })
  await page.waitForTimeout(60)
  expect((await facts())[0].x - backward[0].x).toBeLessThan(-180)
  await page.screenshot({ path: testInfo.outputPath('wind-backward.png') })
  await page.getByRole('checkbox', { name: '减少动态效果' }).check()
  await page.waitForTimeout(60)
  const reduced = await facts()
  await page.evaluate(() => (window as any).__cosmeticScene.driver.step(500))
  await page.waitForTimeout(60)
  const later = await facts()
  expect(later.map((s: any) => [s.x, s.frame])).toEqual(reduced.map((s: any) => [s.x, s.frame]))
  expect(later.every((s: any) => s.frame === 0)).toBe(true)
  expect(later.every((s: any) => s.flipX)).toBe(true)
})
