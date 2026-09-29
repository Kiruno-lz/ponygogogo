/**
 * L3-R：起跑倒计时遮罩在 `?raceSpeed=16` 下只存在约 187ms，
 * 「点完再查」必然错过，「先挂等待再点」能稳定抓到。缺陷说明见同目录 REPRO.md。
 */
import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

/** 走到选马页并选好马与档位，停在按下 RACE 之前 */
async function readyToStart(page: import('@playwright/test').Page): Promise<void> {
  await open(page)
  await enterHome(page)
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.getByTestId('horse-0').click()
  // 有奖档在 P7 之前灰掉，倒计时与档位无关，用 0 档免费试玩走同一段起跑
  await page.getByTestId('bet-panel').locator('.chip').nth(0).click()
}

test('MISSED_WINDOW：点击之后才建立等待，抓不到倒计时遮罩', async ({ page }) => {
  await readyToStart(page)
  await page.locator('button.btn-star').last().click()
  await expect(page.getByTestId('screen-race')).toBeVisible({ timeout: 20_000 })
  // 这里刻意复刻缺陷写法：轮询第一次真正查询时，187ms 的窗口早已关闭
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 8_000 })
})

test('OBSERVED：点击之前挂上等待，同一个窗口能稳定抓到', async ({ page }) => {
  await readyToStart(page)
  const seen = page.getByTestId('countdown').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('button.btn-star').last().click()
  await seen
  await expect(page.getByTestId('screen-race')).toBeVisible()
  // 只断言「看见过」。遮罩的文字内容不能在这之后再查一次——那又是一次事后查询，
  // 会掉进同一个坑；倒计时数字由 L1 的相位与剩余毫秒覆盖。
})
