/**
 * 失败路径：加载失败可重试且指明失败项；入场与结算失败留在当前页面显示错误，不跳白屏。
 *
 * 资源分级之后失败分两类，两类的正确行为完全不同：
 * - 阻塞级（boot/home）失败 → 停在加载页，不放人进首页；
 * - 后台级（race/result）失败 → 不打扰首页，玩家真的点进去时才拦。
 */
import { expect, test } from '@playwright/test'
import { enterHome, noConsoleErrors, open, playUntilResult, startRace } from '../helpers.ts'

const SHOT = 'tests/e2e/screenshots'

/**
 * 首页的标题图。选它是因为它在 manifest 里是 home 级——进首页前必须就绪的阻塞项，
 * 所以注入它的失败一定停在加载页。原先用的 icons.* 现在是 race 级（后台预取），
 * 拿它做阻塞级用例已经不成立了。
 */
const BLOCKING_KEY = 'art.home.logo'

for (const mode of ['404', 'timeout', 'offline'] as const) {
  test(`阻塞级资源失败（${mode}）停在加载页并给出可重试的明确提示`, async ({ page }) => {
    await open(page, `mockDelay=0&mockAssetFail=${BLOCKING_KEY}&mockAssetFailMode=${mode}`)
    await expect(page.getByTestId('loading-error')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('loading-error')).toContainText(BLOCKING_KEY)
    // 没有白屏：加载页仍然完整
    await expect(page.getByTestId('loading-bar')).toBeVisible()
    await expect(page.getByRole('button', { name: /重试失败项|Retry failed items/ })).toBeVisible()
    // 没有放人进去：进入游戏的按钮不该出现
    await expect(page.getByRole('button', { name: /进入游戏|Enter/ })).toHaveCount(0)
    await page.screenshot({ path: `${SHOT}/fail-load-${mode}.png` })
  })
}

test('阻塞级失败后重试成功可以继续进入首页', async ({ page }) => {
  await open(page, `mockDelay=0&mockAssetFail=${BLOCKING_KEY}`)
  await expect(page.getByTestId('loading-error')).toBeVisible({ timeout: 30_000 })
  // 去掉注入的失败开关后重试路径可用
  await page.goto('/?mockDelay=0')
  await enterHome(page)
  await expect(page.getByTestId('screen-home')).toBeVisible()
})

test('后台级资源失败不阻塞首页，点进去时才拦并给出重试入口', async ({ page }) => {
  await open(page, 'mockDelay=0&mockAssetFailTier=race')
  // race 是后台预取的：加载页照样跑满、不报错，正常放人进首页
  await expect(page.getByTestId('loading-progress')).toContainText('100%', { timeout: 30_000 })
  await expect(page.getByTestId('loading-error')).toHaveCount(0)
  await page.getByRole('button', { name: /进入游戏|Enter/ }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()

  // 真的点「开始游戏」才拦下来：明确报错 + 重试入口，首页还在，不白屏
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('tier-gate-error')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('tier-gate-error')).toContainText(/有 \d+ 项资源没能加载|asset\(s\) failed/)
  // 失败项要被点名，不能只说「出错了」
  await expect(page.getByTestId('tier-gate-error').locator('code').first()).toBeVisible()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await expect(page.getByTestId('screen-select')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /重试失败项|Retry failed items/ })).toBeVisible()
  await page.screenshot({ path: `${SHOT}/fail-prefetch-race.png` })

  // 关掉遮罩留在首页，仍然可用
  await page.getByRole('button', { name: /稍后再说|Not now/ }).click()
  await expect(page.getByTestId('tier-gate')).toHaveCount(0)
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
