import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

test('GOGOGO 仅显示居中文字，正方形底图保持原按钮面积和点击尺寸，卡牌不改写按钮文案', async ({ page }, testInfo) => {
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await page.getByRole('button', { name: '特效验收' }).click()
  const gogo = page.getByTestId('gogo')
  await expect(gogo).toBeVisible()
  await expect(gogo).toHaveText('GOGOGO')
  await expect(gogo).toHaveAccessibleName('GOGOGO')
  const label = gogo.locator('.big')
  await expect(label).toHaveCSS('opacity', '1')
  await page.evaluate(() => document.fonts.ready)
  const layout = await gogo.evaluate((button) => {
    const box = button.getBoundingClientRect()
    const text = button.querySelector('.big')!.getBoundingClientRect()
    const style = getComputedStyle(button)
    const face = getComputedStyle(button, '::before')
    return {
      width: parseFloat(style.width), height: parseFloat(style.height),
      faceWidth: parseFloat(face.width), faceHeight: parseFloat(face.height),
      xError: Math.abs(text.x + text.width / 2 - box.x - box.width / 2),
      yError: Math.abs(text.y + text.height / 2 - box.y - box.height / 2),
      subtitleCount: button.querySelectorAll('.sub').length,
    }
  })
  expect([layout.width, layout.height]).toEqual([429, 390])
  expect(layout.faceWidth / layout.faceHeight).toBeCloseTo(1)
  expect(layout.faceWidth * layout.faceHeight / (429 * 390)).toBeCloseTo(1, 2)
  expect(layout.xError).toBeLessThan(2)
  expect(layout.yError).toBeLessThan(2)
  expect(layout.subtitleCount).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('gogo-centered.png') })
  for (const card of ['C-09', 'C-11']) {
    await page.getByRole('combobox', { name: '展示情景' }).selectOption(card)
    await expect(gogo).toHaveText('GOGOGO')
  }
})
