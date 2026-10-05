import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'
import { enterHome, open } from '../helpers.ts'

test('actual showcase typography is sized from the card rather than the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1620, height: 971 })
  await open(page, 'mockDelay=0'); await enterHome(page)
  await page.getByRole('button', { name: '特效验收', exact: true }).click()
  await page.getByRole('button', { name: '预览获得角色', exact: true }).click()
  const sizing = await page.locator('.collectible-panel').evaluate(el => ({
    width: el.getBoundingClientRect().width,
    keepFont: parseFloat(getComputedStyle(el.querySelector('.collectible-keep')!).fontSize),
    nameFont: parseFloat(getComputedStyle(el.querySelector('h3')!).fontSize),
  }))
  expect(sizing.keepFont / sizing.width).toBeLessThanOrEqual(.061)
  expect(sizing.nameFont / sizing.width).toBeLessThanOrEqual(.075)
})

test('actual showcase: baked title, restrained name, blank back and keep-only exit', async ({ page }, info) => {
  await page.setViewportSize({ width: 1620, height: 971 })
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await page.getByRole('button', { name: '特效验收', exact: true }).click()
  await page.getByRole('checkbox', { name: '减少动态效果' }).check()
  await page.getByRole('button', { name: '预览获得角色', exact: true }).click()
  const modal = page.getByTestId('collectible-dialog')
  const panel = modal.locator('.collectible-panel')
  await expect(modal.getByRole('button', { name: '关闭获得物窗口' })).toHaveCount(0)
  await expect(modal.locator('.collectible-back')).toHaveText('')
  await page.keyboard.press('Escape')
  await page.mouse.click(20, 20)
  await expect(panel).toHaveAttribute('data-reveal-phase', 'waiting')
  await modal.getByRole('button', { name: '点击揭晓收藏' }).click()
  await expect(panel).toHaveAttribute('data-reveal-phase', 'revealed')
  await expect(modal.locator('.collectible-front header')).toHaveCount(0)
  const layout = await panel.evaluate(el => {
    const rect = el.getBoundingClientRect(), name = el.querySelector('h3')!, keep = el.querySelector('.collectible-keep')!
    const nameRect = name.getBoundingClientRect()
    return { width: rect.width, nameSize: parseFloat(getComputedStyle(name).fontSize),
      keepSize: parseFloat(getComputedStyle(keep).fontSize), nameTop: (nameRect.top - rect.top) / rect.height }
  })
  expect(layout.nameSize / layout.width).toBeLessThanOrEqual(.075)
  expect(layout.keepSize / layout.width).toBeLessThanOrEqual(.061)
  expect(layout.nameTop).toBeLessThan(.723)
  await page.keyboard.press('Escape')
  await page.mouse.click(20, 20)
  await expect(modal).toBeVisible()
  await page.screenshot({ path: info.outputPath('showcase-pony-front.png') })
  await modal.getByRole('button', { name: '收下', exact: true }).click()
  await expect(modal).toHaveCount(0)
})

test('back-facing pixels never include mirrored front name, collection text or keep button', async ({ page }, info) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await page.evaluate(() => window.collectibleFixture.confirm())
  const clean = PNG.sync.read(await page.locator('.collectible-panel').screenshot({ path: info.outputPath('back-reference.png') }))
  await page.getByRole('button', { name: 'Reveal collectible' }).click()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'spinning')
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const effect = animation.effect as KeyframeEffect
      if (!(effect.target as HTMLElement)?.matches('.collectible-rotation, .collectible-front, .collectible-back')) continue
      animation.pause(); effect.updateTiming({ easing: 'linear' })
      // After four full revolutions the same back must cover all live front content.
      animation.currentTime = Number(effect.getTiming().duration) * 8 / 17
    }
  })
  const rendered = PNG.sync.read(await page.locator('.collectible-panel').screenshot({ path: info.outputPath('back-facing.png') }))
  let changed = 0
  for (let i = 0; i < clean.data.length; i += 4) {
    if ([0, 1, 2].some(c => Math.abs(clean.data[i + c] - rendered.data[i + c]) > 8)) changed++
  }
  expect(changed).toBe(0)
})
