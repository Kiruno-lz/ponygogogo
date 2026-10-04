import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

test.beforeEach(async ({ page }) => {
  await open(page)
  await enterHome(page)
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
})

test('选中的金色圈始终位于马匹下方', async ({ page }, testInfo) => {
  await page.getByTestId('horse-2').click()
  await page.mouse.move(1000, 800)
  await page.getByTestId('screen-select').screenshot({ path: testInfo.outputPath('selected-idle.png') })
  for (const hovered of [false, true]) {
    if (hovered) await page.getByTestId('horse-2').hover()
    const front = await page.getByTestId('horse-2').evaluate((button) => {
      const pony = button.querySelector<HTMLElement>('.pony-portrait')!
      const ring = button.closest('.pony-selection-column')!.querySelector<HTMLElement>('.selection-ground-ring')!
      const p = pony.getBoundingClientRect(), r = ring.getBoundingClientRect()
      // Ask the browser's hit-testing order at an overlapping point; pointer events are normally disabled
      // on both decorative layers so the containing button receives clicks.
      const x = (Math.max(p.left, r.left) + Math.min(p.right, r.right)) / 2
      const y = (Math.max(p.top, r.top) + Math.min(p.bottom, r.bottom)) / 2
      const oldPony = pony.style.pointerEvents, oldRing = ring.style.pointerEvents
      pony.style.pointerEvents = 'auto'; ring.style.pointerEvents = 'auto'
      try {
        // Other lane buttons can overlap this point; compare the two actual artwork layers in paint order.
        return document.elementsFromPoint(x, y).filter(el => el === pony || el === ring).map(el => el.className)
      }
      finally { pony.style.pointerEvents = oldPony; ring.style.pointerEvents = oldRing }
    })
    expect(front.length).toBe(2)
    expect(front[0], `hover=${hovered}: horse must cover the ground ring`).toContain('pony-portrait')
  }
})

test('只有悬浮时显示金色描边，移开后保留选中圈但去掉描边', async ({ page }, testInfo) => {
  const horse = page.getByTestId('horse-2')
  const pony = horse.locator('.pony-portrait')
  await page.mouse.move(1000, 800)
  await expect(pony).toHaveCSS('filter', 'none')
  await horse.hover()
  expect(await pony.evaluate((el) => getComputedStyle(el).filter)).toContain('drop-shadow')
  await horse.click()
  await expect(horse).toHaveAttribute('aria-pressed', 'true')
  expect(await pony.evaluate((el) => getComputedStyle(el).filter)).toContain('drop-shadow')
  await page.getByTestId('screen-select').screenshot({ path: testInfo.outputPath('selected-hover.png') })
  await page.mouse.move(1000, 800)
  await expect(pony).toHaveCSS('filter', 'none')
  const ring = page.getByTestId('selection-ring')
  await expect(ring).toHaveCSS('opacity', '1')
  await expect(ring).toHaveCount(1)
  const before = await ring.boundingBox()
  await page.getByTestId('screen-select').screenshot({ path: testInfo.outputPath('selected-idle.png') })
  await page.getByTestId('horse-4').click()
  await expect(horse).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('horse-4')).toHaveAttribute('aria-pressed', 'true')
  await expect(ring).toHaveCount(1)
  expect((await ring.boundingBox())!.y).not.toBe(before!.y)
})
