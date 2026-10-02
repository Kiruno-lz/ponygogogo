import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

test.use({ browserName: 'webkit' })

test('未登录首次选牌时拖选和全选不会产生蓝色图片遮罩，键盘仍可选牌', async ({ page }, testInfo) => {
  await open(page, 'raceSpeed=16&mockDelay=0&seed=0x00004242')
  await enterHome(page)
  await expect(page.getByRole('button', { name: /^登录|LOG IN/ })).toBeVisible()
  await startRace(page)
  await expect(page.getByTestId('card-panel')).toBeVisible({ timeout: 60_000 })
  const card = page.getByTestId('card-choice-1').locator('.card-root')
  await expect(page.getByTestId('card-choice-1')).toHaveCSS('opacity', '1')
  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x - 12, box.y + box.height + 8, { steps: 20 })
  await page.mouse.up()
  await page.keyboard.press('Meta+A')
  await page.screenshot({ path: testInfo.outputPath('anonymous-first-choice.png') })
  const selected = await card.evaluate((el) => {
    const selection = window.getSelection()
    return [...el.querySelectorAll('img')].some((img) => selection?.containsNode(img, true))
  })
  expect(selected).toBe(false)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    if (await card.evaluate((el) => el === document.activeElement)) break
  }
  await expect(card).toBeFocused()
  await expect(card).toHaveCSS('filter', /drop-shadow/)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('card-panel')).toBeHidden()
})
