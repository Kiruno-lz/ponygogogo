import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { paidCardDef } from '../../../src/race/cards/paidCards.ts'

test('effect showcase previews the selected pony result and returns to the same scenario', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await page.getByRole('button', { name: '特效验收', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览结果界面', exact: true })).toBeDisabled()
  await page.getByTestId('horse-3').click()
  await page.locator('.select-race-cta button').click()
  await page.getByRole('combobox', { name: '展示情景' }).selectOption('C-07')
  await page.getByRole('button', { name: '预览结果界面', exact: true }).click()
  await expect(page.getByTestId('screen-result')).toBeVisible()
  await expect(page.locator('.result-hero')).toHaveAttribute('src', '/assets/art/result/hero-3.webp')
  await expect(page.getByTestId('result-choice-0')).toContainText(paidCardDef('C-07')!.name.zh)
  await expect.poll(() => page.getByTestId('screen-result').locator('img').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.screenshot({ path: info.outputPath('showcase-result-preview.png') })
  await page.getByRole('button', { name: '返回特效验收', exact: true }).click()
  await expect(page.getByTestId('screen-race')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '展示情景' })).toHaveValue('C-07')
  expect(errors).toEqual([])
})
