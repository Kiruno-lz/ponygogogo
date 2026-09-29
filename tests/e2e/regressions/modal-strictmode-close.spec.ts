/**
 * L3-R：模态窗口（StageDialog）在开发模式下一打开就自己关掉。缺陷说明见同目录 REPRO.md 第四节。
 */
import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

test('STALE_CLOSE：点注册，取名窗口打开后留在屏幕上，而不是被 StrictMode 排队的 close 事件关掉', async ({ page }) => {
  await open(page)
  await enterHome(page)
  await page.getByRole('button', { name: /^注册|Sign up/ }).first().click()

  const modal = page.getByTestId('register-modal')
  await expect(modal).toBeVisible({ timeout: 3_000 })
  // 排队的 close 任务在打开后的下一轮事件循环里就会派发；留足余量后做一次性判定，
  // 不用会自动重试的断言——缺陷版本里窗口根本不在 DOM 里，重试只会一路等到超时
  await page.waitForTimeout(500)
  expect(await modal.isVisible()).toBe(true)
  expect(await modal.evaluate((d) => (d as HTMLDialogElement).open && d.matches(':modal'))).toBe(true)
})
