import { expect, test } from '@playwright/test'
import { PAID_CARD_POOL } from '../../../src/race/cards/paidCards.ts'
import { enterHome, open } from '../helpers.ts'

test.use({ video: 'on' })

test('验收入口复用完整选马、比赛与收藏窗口，覆盖全部角色、卡牌和队列箭头', async ({ page }, info) => {
  const errors: string[] = []
  const failedAssets: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/assets/')) failedAssets.push(response.url()) })
  await open(page, 'mockDelay=0')
  await enterHome(page)
  page.on('request', request => {
    if (request.url().includes('monad.xyz') || request.url().includes('alchemy.com') || request.url().includes('/api/collection')) externalRequests.push(request.url())
  })
  await page.getByRole('button', { name: '特效验收', exact: true }).click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  const scenario = page.getByRole('combobox', { name: '展示情景' })
  expect(await scenario.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toEqual(PAID_CARD_POOL.map(card => card.cardId))
  await expect(page.getByTestId('pony-queue-up')).toBeDisabled()
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('pony-queue-down').click()
    await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  }
  await expect(page.getByTestId('pony-queue-down')).toBeDisabled()
  await page.getByTestId('horse-8').click()
  await page.screenshot({ path: info.outputPath('showcase-selection-nine-roles.png') })
  await page.locator('.select-race-cta button').click()
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(() => page.getByTestId('leaderboard').locator('img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.getByRole('button', { name: '显示效果', exact: true }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '前进 100 ms' }).click()
  await page.screenshot({ path: info.outputPath('showcase-gugu-spin.png') })
  for (const card of ['C-07', 'C-10', 'C-11', 'C-13', 'C-22', 'C-31', 'C-37', 'C-38', 'C-40']) {
    await scenario.selectOption(card)
    await expect(page.locator('canvas')).toBeVisible()
    await page.getByRole('button', { name: '显示效果', exact: true }).click()
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await page.waitForTimeout(150)
    await page.screenshot({ path: info.outputPath(`showcase-${card}.png`) })
  }
  await page.getByRole('combobox', { name: '获得角色' }).selectOption('8')
  await page.getByRole('button', { name: '预览获得角色', exact: true }).focus()
  await page.getByRole('button', { name: '预览获得角色', exact: true }).press('Enter')
  await expect(page.getByTestId('collectible-dialog').locator('.collectible-panel')).toHaveAttribute('data-asset-id', '8')
  await page.getByRole('button', { name: '点击揭晓收藏' }).click()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await page.screenshot({ path: info.outputPath('showcase-pony-grant.png') })
  await page.getByRole('button', { name: '收下', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览获得角色', exact: true })).toBeFocused()
  await page.getByRole('combobox', { name: '获得稀有卡' }).selectOption('C-40')
  await page.getByRole('button', { name: '预览获得稀有卡', exact: true }).focus()
  await page.getByRole('button', { name: '预览获得稀有卡', exact: true }).press('Enter')
  await expect(page.getByTestId('collectible-dialog').locator('.collectible-panel')).toHaveAttribute('data-asset-kind', 'rareCard')
  await expect(page.getByTestId('collectible-dialog').locator('.collectible-panel')).toHaveAttribute('data-asset-id', '40')
  await page.getByRole('button', { name: '点击揭晓收藏' }).click()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await page.screenshot({ path: info.outputPath('showcase-rare-grant.png') })
  await page.getByRole('button', { name: '收下', exact: true }).click()
  await page.getByRole('button', { name: '选马', exact: true }).click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  expect(errors).toEqual([])
  expect(failedAssets).toEqual([])
  expect(externalRequests).toEqual([])
})
