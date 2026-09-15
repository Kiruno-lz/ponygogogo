/**
 * 失败路径：加载失败可重试且指明失败项；入场与结算失败留在当前页面显示错误，不跳白屏。
 */
import { expect, test } from '@playwright/test'
import { enterHome, noConsoleErrors, open, playUntilResult, startRace } from '../helpers.ts'

const SHOT = 'tests/e2e/screenshots'

for (const mode of ['404', 'timeout', 'offline'] as const) {
  test(`加载失败（${mode}）停在加载页并给出可重试的明确提示`, async ({ page }) => {
    await open(page, `mockDelay=0&mockAssetFail=icons&mockAssetFailMode=${mode}`)
    await expect(page.getByTestId('loading-error')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('loading-error')).toContainText('icons')
    // 没有白屏：加载页仍然完整
    await expect(page.getByTestId('loading-bar')).toBeVisible()
    await expect(page.getByRole('button', { name: /重试失败项|Retry failed items/ })).toBeVisible()
    await page.screenshot({ path: `${SHOT}/fail-load-${mode}.png` })
  })
}

test('加载失败后重试成功可以继续进入首页', async ({ page }) => {
  await open(page, 'mockDelay=0&mockAssetFail=icons')
  await expect(page.getByTestId('loading-error')).toBeVisible({ timeout: 30_000 })
  // 去掉注入的失败开关后重试路径可用
  await page.goto('/?mockDelay=0')
  await enterHome(page)
  await expect(page.getByTestId('screen-home')).toBeVisible()
})

test('入场失败留在选马页显示错误，不跳白屏', async ({ page }) => {
  await open(page, 'mockDelay=0&mockFail=enter&raceSpeed=16')
  await enterHome(page)
  await startRace(page, 0, 0)
  await expect(page.getByTestId('enter-error')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.screenshot({ path: `${SHOT}/fail-enter.png` })
})

test('结算失败留在结算页并可重试', async ({ page }) => {
  const errors = await noConsoleErrors(page)
  await open(page, 'mockDelay=0&mockFail=settle&raceSpeed=16')
  await enterHome(page)
  await startRace(page, 0, 0)
  await playUntilResult(page)
  await expect(page.getByTestId('settle-status')).toContainText(/结算没有成功|did not go through/)
  await expect(page.getByTestId('result-rank')).toHaveText(/^[1-5]$/)
  await page.screenshot({ path: `${SHOT}/fail-settle.png` })
  // 名次先显示、资金状态另算：两者不合并成一个转圈
  await expect(page.getByRole('button', { name: /重试结算|Retry/ })).toBeVisible()
  expect(errors.filter((e) => !e.includes('SETTLE_FAILED'))).toEqual([])
})
