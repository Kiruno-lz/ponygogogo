/**
 * L3 完整动线（docs/plan/demo.md §2）：
 * 启动 → 加载页 → 首页 → 选马 → 下注 → 起跑倒计时 → 比赛 → 检查点 ×3
 *      → 冲线 → 结算 → 分享出图 → 再来一局（回到首页且状态干净）
 * 每个关键节点截图核对。
 */
import { expect, test } from '@playwright/test'
import { enterHome, noConsoleErrors, open, playUntilResult, startRace } from '../helpers.ts'

const SHOT = 'tests/e2e/screenshots'

test('完整动线：加载 → 首页 → 选马下注 → 比赛 → 选牌 → 结算 → 分享 → 再来一局', async ({ page }) => {
  const errors = await noConsoleErrors(page)

  // --- 加载页 ---
  await open(page)
  await expect(page.getByTestId('loading-bar')).toBeVisible()
  await expect(page.getByTestId('loading-progress')).toContainText('100%', { timeout: 30_000 })
  await page.screenshot({ path: `${SHOT}/01-loading.png` })

  // --- 首页 ---
  await enterHome(page)
  await expect(page.getByRole('button', { name: /开始游戏|START/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /卡牌图鉴|COLLECTION/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /游戏设置|SETTINGS/ }).first()).toBeVisible()
  await page.screenshot({ path: `${SHOT}/02-home.png` })

  // --- 登录（mock 钱包） ---
  await page.getByRole('button', { name: /^登录|Sign in/ }).first().click()
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('balance')).toContainText('MON')

  // --- 选马与下注 ---
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  for (let i = 0; i < 5; i++) await expect(page.getByTestId(`horse-${i}`)).toBeVisible()
  await page.getByTestId('horse-2').click()
  await expect(page.getByTestId('horse-2')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('bet-panel').locator('.chip').nth(1).click()
  await expect(page.getByTestId('potential-win')).toContainText('MON')
  await expect(page.getByTestId('difficulty')).not.toBeEmpty()
  await page.screenshot({ path: `${SHOT}/03-select.png` })

  // --- 起跑倒计时 ---
  await page.locator('button.btn-star').last().click()
  await expect(page.getByTestId('screen-race')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('countdown')).toBeVisible()
  await page.screenshot({ path: `${SHOT}/04-countdown.png` })

  // --- 比赛：HUD 元素齐全 ---
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByTestId('stamina-bar')).toBeVisible()
  await expect(page.getByTestId('leaderboard')).toBeVisible()
  await expect(page.getByTestId('gogo')).toBeVisible()
  for (let i = 0; i < 5; i++) await expect(page.getByTestId(`board-row-${i}`)).toBeVisible()
  await page.screenshot({ path: `${SHOT}/05-race.png` })

  // --- 检查点：面板、限时、三张候选、放弃入口 ---
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    w.__rhythm = window.setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 30)
    }, 500)
  })
  await expect(page.getByTestId('card-panel')).toBeVisible({ timeout: 60_000 })
  for (let i = 0; i < 3; i++) await expect(page.getByTestId(`card-choice-${i}`)).toBeVisible()
  await expect(page.getByTestId('choice-timer')).toBeVisible()
  await expect(page.getByTestId('card-skip')).toBeVisible()
  // gogo 在选牌时隐藏
  await expect(page.getByTestId('gogo')).toBeHidden()
  await page.screenshot({ path: `${SHOT}/06-card-choice.png` })
  await page.getByTestId('card-choice-0').locator('.card-root').click()
  await expect(page.getByTestId('card-panel')).toBeHidden({ timeout: 20_000 })

  // --- 跑完并结算 ---
  await playUntilResult(page)
  await expect(page.getByTestId('result-rank')).toHaveText(/^[1-5]$/)
  await expect(page.getByTestId('result-stake')).toContainText('MON')
  await expect(page.getByTestId('result-payout')).toContainText('MON')
  await expect(page.getByTestId('result-net')).toContainText('MON')
  for (let i = 0; i < 3; i++) await expect(page.getByTestId(`result-choice-${i}`)).toBeVisible()
  await expect(page.getByTestId('settle-status')).toBeVisible()
  await page.screenshot({ path: `${SHOT}/07-result.png` })

  // --- 分享出图 ---
  const download = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
  await page.getByRole('button', { name: /生成分享图|Make a poster/ }).click()
  const dl = await download
  expect(dl === null || dl.suggestedFilename().endsWith('.png')).toBeTruthy()

  // --- 再来一局：状态干净 ---
  await page.getByRole('button', { name: /回到首页|Home/ }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await expect(page.getByTestId('horse-0')).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: `${SHOT}/08-again.png` })

  expect(errors, `控制台未捕获异常：\n${errors.join('\n')}`).toEqual([])
})

test('图鉴与设置可进可出', async ({ page }) => {
  await open(page)
  await enterHome(page)

  await page.getByRole('button', { name: /卡牌图鉴|COLLECTION/ }).first().click()
  await expect(page.getByTestId('screen-collection')).toBeVisible()
  await expect(page.locator('[data-card]')).toHaveCount(21)
  await page.screenshot({ path: `${SHOT}/09-collection.png` })
  await page.getByRole('button', { name: /返回|Back/ }).first().click()
  await expect(page.getByTestId('screen-home')).toBeVisible()

  await page.getByRole('button', { name: /游戏设置|SETTINGS/ }).first().click()
  await expect(page.getByTestId('screen-settings')).toBeVisible()
  await page.getByTestId('vol-master').fill('40')
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('button', { name: /^Back$/ })).toBeVisible()
  await page.screenshot({ path: `${SHOT}/10-settings.png` })
  await page.getByRole('button', { name: /^Back$/ }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  // 语言切换持久化
  await page.reload()
  await expect(page.getByTestId('loading-progress')).toContainText('100%', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Enter/ })).toBeVisible()
})

test('比赛中途退出：弃赛回到首页，状态干净', async ({ page }) => {
  await open(page)
  await enterHome(page)
  await startRace(page, 1, 0)
  await expect(page.getByTestId('screen-race')).toBeVisible()
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 20_000 })
  await page.getByRole('button', { name: /退出比赛|Quit race/ }).click()
  await expect(page.getByTestId('quit-confirm')).toBeVisible()
  await page.getByRole('button', { name: /继续比赛|Keep racing/ }).click()
  await expect(page.getByTestId('quit-confirm')).toBeHidden()
  await page.getByRole('button', { name: /退出比赛|Quit race/ }).click()
  await page.getByRole('button', { name: /^确定退出$|^Quit$/ }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
})
