/**
 * 失败路径：加载失败可重试且指明失败项；游戏账户或 RPC 不可用时钱包降级显示，不跳白屏、不谎报余额。
 *
 * 资源分级之后失败分两类，两类的正确行为完全不同：
 * - 阻塞级（boot/home）失败 → 停在加载页，不放人进首页；
 * - 后台级（race/result）失败 → 不打扰首页，玩家真的点进去时才拦。
 */
import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, registerAs, stubChain } from '../walletHarness.ts'

const SHOT = 'tests/e2e/screenshots'

/**
 * 首页的标题图。选它是因为它在 manifest 里是 home 级——进首页前必须就绪的阻塞项，
 * 所以注入它的失败一定停在加载页。原先用的 icons.* 现在是 race 级（后台预取），
 * 拿它做阻塞级用例已经不成立了。
 */
const BLOCKING_KEY = 'art.home.logo'

for (const mode of ['404', 'timeout', 'offline'] as const) {
  test(`阻塞级资源失败（${mode}）停在加载页并给出可重试的明确提示`, async ({ page }) => {
    await open(page, `mockAssetFail=${BLOCKING_KEY}&mockAssetFailMode=${mode}`)
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
  await open(page, `mockAssetFail=${BLOCKING_KEY}`)
  await expect(page.getByTestId('loading-error')).toBeVisible({ timeout: 30_000 })
  // 去掉注入的失败开关后重试路径可用
  await page.goto('/')
  await enterHome(page)
  await expect(page.getByTestId('screen-home')).toBeVisible()
})

test('后台级资源失败不阻塞首页，点进去时才拦并给出重试入口', async ({ page }) => {
  await open(page, 'mockAssetFailTier=race')
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

test('游戏账户连不上：注册仍成功，不领水、不谎报余额，钱包里说明原因', async ({ page }) => {
  await addAuthenticator(page)
  const chain = await stubChain(page, { alchemy: 'down' })
  await open(page)
  await enterHome(page)
  await registerAs(page, 'offline')

  await expect(page.getByTestId('notice')).toHaveText(/游戏账户暂时连不上|Could not reach your game account/, { timeout: 20_000 })
  await expect(page.getByTestId('wallet-label')).toHaveText('…')
  await expect(page.getByTestId('balance')).toHaveText('—')
  // 测试币只发给游戏账户：没有 sma-b 就不领，绝不回落到签名账户
  expect(chain.faucetCalls()).toBe(0)
  expect(chain.alchemyRequests()).toBeGreaterThan(0)

  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-address-pending')).toHaveText(/游戏账户暂时连不上|Could not reach your game account/)
  await expect(page.getByTestId('wallet-signer-address')).toHaveCount(0)
  await expect(page.getByTestId('wallet-balance')).toHaveText('—')
  await expect(page.getByRole('button', { name: /^领取测试币$|^Get test MON$/ })).toBeDisabled()
  await page.screenshot({ path: `${SHOT}/fail-game-account.png` })

  // 刷新会重试解析，仍然失败就原样报出来，不把旧数字当新数字
  await page.getByRole('button', { name: /^刷新余额$|^Refresh balance$/ }).click()
  await expect(page.getByTestId('wallet-message')).toHaveText(/游戏账户暂时连不上|Could not reach your game account/)
})

test('有奖档位灰掉不可选，开赛按钮只对免费试玩生效', async ({ page }) => {
  await open(page, 'raceSpeed=16')
  await enterHome(page)
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  const chips = page.getByTestId('bet-panel').locator('.chip')
  // 强行点灰掉的档位也选不上，选中态停在 0 档
  await chips.nth(3).click({ force: true })
  await expect(chips.nth(0)).toHaveClass(/\bon\b/)
  await expect(chips.nth(3)).not.toHaveClass(/\bon\b/)
  await page.getByTestId('horse-1').click()
  await page.locator('button.btn-star').last().click()
  await expect(page.getByTestId('screen-race')).toBeVisible()
})
