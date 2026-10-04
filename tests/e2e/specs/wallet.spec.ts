/**
 * L3 钱包动线：取名注册 → 解析游戏账户（sma-b）并给它领测试币 → 看游戏账户、签名账户与原生余额
 *            → 导出助记词 → 退出 → 登录回同一个游戏账户；以及把签名账户的余额迁入游戏账户。
 *
 * 通行密钥用 Chrome 的 CDP 虚拟认证器（开 PRF 扩展）驱动，跑的是真实的 mera 代码路径；
 * RPC、水龙头与 Alchemy 都在路由层拦下，测试不打真实测试网、不消耗水龙头额度。
 * 构建未配置 Vault 地址，所以余额直接读取智能账户，不提供 Vault 充值或提款。
 */
import { expect, test } from '@playwright/test'
import { enterHome, noConsoleErrors, open } from '../helpers.ts'
import { ONE_MON, addAuthenticator, logout, readAddress, readAddresses, registerAs, smaFor, stubChain } from '../walletHarness.ts'

const SHOT = 'tests/e2e/screenshots'

test('钱包动线：取名注册 → 游戏账户领币 → 两个地址与智能账户余额 → 导出助记词 → 退出 → 登录回同一账户', async ({ page }) => {
  const errors = await noConsoleErrors(page)
  await addAuthenticator(page)
  const chain = await stubChain(page)

  await open(page)
  await enterHome(page)

  // --- 取名窗口：默认填 ponygogogo，确认后才唤起通行密钥 ---
  await page.getByRole('button', { name: /^注册|Sign up/ }).first().click()
  await expect(page.getByTestId('register-modal')).toBeVisible()
  await expect(page.getByTestId('register-name')).toHaveValue('ponygogogo')
  await expect(page.getByTestId('wallet-panel')).toBeHidden()
  expect(chain.faucetCalls()).toBe(0)
  await page.screenshot({ path: `${SHOT}/20-register-name.png` })

  await page.getByTestId('register-name').fill('小马仔')
  await page.getByRole('button', { name: /创建通行密钥|Create passkey/ }).click()

  // --- 注册：派生根地址 → 解析 sma-b → 给 sma-b 领一次测试币 ---
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('register-modal')).toBeHidden()
  // 领到的那一个 MON 必须真的显示出来，而不是停在占位符
  await expect(page.getByTestId('balance')).toContainText('1.00 MON', { timeout: 30_000 })
  expect(chain.faucetCalls()).toBe(1)
  await page.screenshot({ path: `${SHOT}/21-wallet-registered.png` })

  // --- 钱包面板：游戏账户、签名账户、网络、钱包余额 ---
  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-modal')).toBeVisible()
  const game = (await page.getByTestId('wallet-address').innerText()).trim()
  const signer = (await page.getByTestId('wallet-signer-address').innerText()).trim()
  expect(game).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(signer).toMatch(/^0x[0-9a-fA-F]{40}$/)
  // 游戏账户是签名者拥有的另一个地址，测试币只发给它
  expect(game).toBe(smaFor(signer))
  expect(game).not.toBe(signer)
  expect(chain.faucetAddresses()).toEqual([game])
  await expect(page.getByTestId('wallet-network')).toHaveText('Monad Testnet')
  await expect(page.getByTestId('wallet-balance')).toHaveText('1.0000 MON')
  await expect(page.getByTestId('wallet-game-balance')).toHaveCount(0)
  await expect(page.getByTestId('wallet-amount')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^充值$|^Deposit$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^提款$|^Withdraw$/ })).toHaveCount(0)
  // 签名账户里没有钱，不露出迁移入口
  await expect(page.getByTestId('wallet-migrate')).toHaveCount(0)
  await page.screenshot({ path: `${SHOT}/22-wallet-modal.png` })
  await page.getByRole('button', { name: /^关闭$|^Close$/ }).click()

  // 木牌上的摘要就是游戏账户，不是签名账户
  await expect(page.getByTestId('wallet-label')).toHaveText(`${game.slice(0, 6)}…${game.slice(-4)}`)

  // --- 导出助记词：二次验证通行密钥后给出 24 个词 ---
  await page.getByTestId('wallet-open').click()
  await page.getByRole('button', { name: /导出助记词|Export recovery phrase/ }).click()
  await expect(page.getByTestId('wallet-mnemonic')).toBeVisible({ timeout: 20_000 })
  const words = await page.getByTestId('wallet-mnemonic').locator('li').allInnerTexts()
  expect(words).toHaveLength(24)
  expect(words.every((w) => /^[a-z]+$/.test(w.trim()))).toBe(true)
  await page.screenshot({ path: `${SHOT}/23-wallet-mnemonic.png` })
  await page.getByRole('button', { name: /我记好了|Got it/ }).click()
  await expect(page.getByTestId('wallet-mnemonic')).toBeHidden()

  // --- 退出：面板里没有退出按钮，走首页木牌上的入口 ---
  // 这次用 Escape 关（关闭按钮上面已经点过）：焦点回到打开它的木牌，助记词随面板一起卸掉
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wallet-modal')).toBeHidden()
  await expect(page.getByTestId('wallet-open')).toBeFocused()
  await expect(page.getByTestId('wallet-mnemonic')).toHaveCount(0)
  await logout(page)
  await expect(page.getByRole('button', { name: /^登录|Sign in/ }).first()).toBeVisible()

  // --- 登录：系统自己列出该域名下的通行密钥，回到同一个签名者与同一个游戏账户 ---
  await page.getByRole('button', { name: /^登录|Sign in/ }).first().click()
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('balance')).toContainText('1.00 MON')
  expect(await readAddresses(page)).toEqual({ game, signer })
  // 登录不再领一次水
  expect(chain.faucetCalls()).toBe(1)

  expect(errors).toEqual([])
})

test('签名账户里的旧余额迁入游戏账户：已提交 → 已入块，附交易链接', async ({ page }) => {
  const errors = await noConsoleErrors(page)
  await addAuthenticator(page)
  const chain = await stubChain(page)
  await open(page)
  await enterHome(page)
  await registerAs(page, '迁移')
  await expect(page.getByTestId('balance')).toContainText('1.00 MON', { timeout: 30_000 })
  const { game, signer } = await readAddresses(page)

  // 早期版本把测试币领到了签名账户
  chain.credit(signer, 2n * ONE_MON)
  await page.getByTestId('wallet-open').click()
  await page.getByRole('button', { name: /^刷新余额$|^Refresh balance$/ }).click()
  await expect(page.getByTestId('wallet-migrate')).toBeVisible()
  await expect(page.getByTestId('wallet-migrate')).toContainText('2.0000 MON')
  await page.screenshot({ path: `${SHOT}/25-wallet-migrate-offer.png` })

  await page.getByTestId('wallet-migrate').getByRole('button', { name: /转入游戏账户|Move to game account/ }).click()
  await expect(page.getByTestId('wallet-tx')).toHaveAttribute('data-phase', 'included', { timeout: 20_000 })
  await expect(page.getByTestId('wallet-tx')).toContainText(/已入块|included/)
  const tx = chain.rawTransactions()
  expect(tx).toHaveLength(1)
  expect(tx[0]!.from).toBe(signer)
  expect(tx[0]!.to).toBe(game)
  // 金额 = 余额 − 21000 × (1.2 × 100 gwei + 2 gwei)
  expect(tx[0]!.value).toBe(2n * ONE_MON - 21_000n * 122n * 10n ** 9n)
  const link = page.getByTestId('wallet-tx-link')
  await expect(link).toHaveAttribute('href', /^https:\/\/testnet\.monadexplorer\.com\/tx\/0x[0-9a-f]{64}$/)
  // 余额随之刷新：游戏账户涨了，签名账户只剩手续费零头，迁移入口收起
  await expect(page.getByTestId('wallet-balance')).toHaveText('2.9974 MON')
  await expect(page.getByTestId('wallet-migrate')).toHaveCount(0)
  await page.screenshot({ path: `${SHOT}/26-wallet-migrated.png` })
  expect(errors).toEqual([])
})

test('注册两把通行密钥，各自是独立账户，登录落在系统挑中的那一把上', async ({ page }) => {
  await addAuthenticator(page)
  await stubChain(page)
  await open(page)
  await enterHome(page)

  await registerAs(page, '一号')
  const first = await readAddress(page)
  await logout(page)

  await registerAs(page, '二号')
  const second = await readAddress(page)
  expect(second).not.toBe(first)
  await logout(page)

  // 挑哪一把是平台弹窗的事，我们不限定也不预测；能保证的是登录必然落在
  // 已注册的某个账户上，而不是又派生出第三个地址
  await page.getByRole('button', { name: /^登录|Sign in/ }).first().click()
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('wallet-label')).not.toHaveText('…')
  expect([first, second]).toContain(await readAddress(page))
})

test('没有通行密钥时，注册失败留在首页并给出可读的错误', async ({ page }) => {
  await stubChain(page)
  // 不装虚拟认证器：headless Chromium 没有可用的平台认证器
  await open(page)
  await enterHome(page)

  await page.getByRole('button', { name: /^注册|Sign up/ }).first().click()
  await page.getByRole('button', { name: /创建通行密钥|Create passkey/ }).click()
  await expect(page.getByTestId('wallet-error')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await expect(page.getByTestId('wallet-panel')).toBeHidden()
  await page.screenshot({ path: `${SHOT}/24-wallet-error.png` })
})
