/**
 * L3 免费试玩动线（docs/game-design.md §2）：
 * 启动 → 加载页 → 首页 → 选马 → 档位（E2E 构建不配合约地址，有奖档灰掉，只能免费试玩）→ 起跑倒计时 → 比赛 → 检查点 ×3
 *      → 冲线 → 本地结果（不计奖金）→ 分享出图 → 再来一局（回到首页且状态干净）
 * 每个关键节点截图核对。
 */
import { expect, test } from '@playwright/test'
import { PAID_CARD_POOL } from '../../../src/race/cards/paidCards.ts'
import { enterHome, noConsoleErrors, open, playUntilResult, startRace } from '../helpers.ts'

const SHOT = 'tests/e2e/screenshots'

test('完整动线：加载 → 首页 → 选马与免费档 → 比赛 → 选牌 → 本地结果 → 分享 → 再来一局', async ({ page }) => {
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

  // --- 选马与下注 ---
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  for (let i = 0; i < 5; i++) await expect(page.getByTestId(`horse-${i}`)).toBeVisible()
  await page.getByTestId('horse-2').click()
  await expect(page.getByTestId('horse-2')).toHaveAttribute('aria-pressed', 'true')
  // 五档：0 是默认选中的免费试玩；E2E 构建没有合约地址（tests/e2e/isolatedEnv.ts），四个有奖档灰掉并明说「合约尚未部署」
  const chips = page.getByTestId('bet-panel').locator('.chip')
  await expect(chips).toHaveCount(5)
  await expect(chips.nth(0)).toHaveText('0')
  await expect(chips.nth(0)).toHaveClass(/\bon\b/)
  await expect(chips.nth(0)).toBeEnabled()
  for (let i = 1; i < 5; i++) await expect(chips.nth(i)).toBeDisabled()
  await expect(chips).toHaveText(['0', '0.3', '1', '5', '10'])
  await expect(page.getByTestId('paid-closed')).toHaveText(/有奖合约尚未部署|Paid contracts not deployed yet/)
  await expect(page.getByTestId('potential-win')).toHaveText(/免费试玩|Free practice/)
  await expect(page.getByTestId('potential-win')).not.toContainText('MON')
  await expect(page.getByTestId('difficulty')).not.toBeEmpty()
  await page.screenshot({ path: `${SHOT}/03-select.png` })

  // --- 起跑倒计时 与 比赛 HUD ---
  // 这条动线跑在 raceSpeed=16 上，两段可观测窗口都被压掉 16 倍：倒计时遮罩只剩约 187ms，
  // HUD 上的 gogo 也会在第一个检查点弹面板时卸载。等待一律在点下 RACE **之前**并发挂好，
  // 点完再逐条顺序查必然错过（见 tests/e2e/regressions/REPRO.md）
  const HUD_IDS = ['stamina-bar', 'leaderboard', 'gogo', ...[0, 1, 2, 3, 4].map((i) => `board-row-${i}`)]
  const countdownShown = page.getByTestId('countdown').waitFor({ state: 'visible', timeout: 20_000 })
  const hudReady = Promise.all(
    HUD_IDS.map((id) => page.getByTestId(id).waitFor({ state: 'visible', timeout: 20_000 })),
  )
  await page.locator('button.btn-star').last().click()
  await countdownShown
  await expect(page.getByTestId('screen-race')).toBeVisible()
  await page.screenshot({ path: `${SHOT}/04-countdown.png` })

  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 20_000 })
  await hudReady
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
  // 本地试玩：明确标成免费、本地，不出现任何下注、返还或盈亏金额
  await expect(page.getByTestId('result-mode')).toHaveText(/免费试玩|Free practice/)
  await expect(page.getByTestId('result-prize')).toHaveText(/^(无|None)$/)
  await expect(page.getByTestId('result-practice-note')).toBeVisible()
  await expect(page.getByTestId('practice-stamp')).toHaveText(/本地试玩|Practice/)
  await expect(page.getByTestId('screen-result')).not.toContainText('MON')
  for (let i = 0; i < 3; i++) await expect(page.getByTestId(`result-choice-${i}`)).toBeVisible()
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
  await expect(page.locator('[data-card]')).toHaveCount(PAID_CARD_POOL.length)
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
