import { expect, test } from '@playwright/test'
import { CARD_POOL } from '../../../src/race/cards/pool.ts'
import { enterHome, open } from '../helpers.ts'

test.use({ video: 'on' })

test('开发首页进入确定性特效验收场景并可暂停、逐步推进、重播、返回', async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await open(page, 'mockDelay=0')
  await enterHome(page)

  const entry = page.getByRole('button', { name: '特效验收' })
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByText('特效验收', { exact: true }).last()).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('effect-showcase-c02.png') })

  const scenario = page.getByRole('combobox', { name: '展示情景' })
  expect(await scenario.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)))
    .toEqual(CARD_POOL.map((card) => card.cardId))
  await scenario.selectOption('C-07')
  await page.waitForTimeout(250)
  await page.screenshot({ path: testInfo.outputPath('effect-showcase-c07.png') })
  await scenario.selectOption('C-13')
  await page.getByRole('button', { name: '暂停' }).click()
  await expect(page.getByRole('button', { name: '继续' })).toBeVisible()
  const step = page.getByRole('button', { name: '前进 100 ms' })
  await expect(step).toBeEnabled()
  await step.click()
  await page.getByRole('button', { name: '重播' }).click()
  await page.waitForTimeout(1_700)
  await page.screenshot({ path: testInfo.outputPath('effect-showcase-c13.png') })
  await scenario.selectOption('C-10')
  await page.waitForTimeout(250)
  await page.screenshot({ path: testInfo.outputPath('effect-showcase-c10.png') })
  await scenario.selectOption('C-11')
  await page.waitForTimeout(250)
  await page.screenshot({ path: testInfo.outputPath('effect-showcase-c11.png') })

  let swapAudioRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/sfx_swap.')) swapAudioRequests++
  })
  await scenario.selectOption('C-09')
  await page.waitForTimeout(1_300)
  expect(swapAudioRequests).toBe(1)
  await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible()
  await page.getByRole('button', { name: '返回首页' }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  expect(pageErrors).toEqual([])
})
