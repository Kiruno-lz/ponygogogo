/**
 * L3 钱包动线：取名注册 → 领测试币 → 看地址与余额 → 导出助记词 → 退出 → 登录回同一个地址。
 *
 * 通行密钥用 Chrome 的 CDP 虚拟认证器（开 PRF 扩展）驱动，跑的是真实的 mera 代码路径；
 * RPC 与水龙头都在路由层拦下，测试不打真实测试网、不消耗水龙头额度。
 */
import { expect, test } from '@playwright/test'
import { enterHome, noConsoleErrors, open } from '../helpers.ts'
import { addAuthenticator, logout, readAddress, registerAs, stubChain } from '../walletHarness.ts'

const SHOT = 'tests/e2e/screenshots'

test('钱包动线：取名注册领币 → 地址与余额 → 导出助记词 → 退出 → 登录回同一地址', async ({ page }) => {
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

  // --- 注册：派生地址 → 自动领一次测试币 ---
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('register-modal')).toBeHidden()
  await expect(page.getByTestId('wallet-label')).toContainText('0x')
  // 领到的那一个 MON 必须真的显示出来，而不是停在占位符
  await expect(page.getByTestId('balance')).toContainText('1.00 MON', { timeout: 30_000 })
  expect(chain.faucetCalls()).toBe(1)
  await page.screenshot({ path: `${SHOT}/21-wallet-registered.png` })

  // --- 钱包面板：完整地址、链上余额、游戏余额 ---
  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-modal')).toBeVisible()
  const address = (await page.getByTestId('wallet-address').innerText()).trim()
  expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  await expect(page.getByTestId('wallet-balance')).toContainText('1.0000 MON')
  await expect(page.getByTestId('wallet-game-balance')).toContainText('10.00 MON')
  await page.screenshot({ path: `${SHOT}/22-wallet-modal.png` })

  // --- 导出助记词：二次验证通行密钥后给出 24 个词 ---
  await page.getByRole('button', { name: /导出助记词|Export recovery phrase/ }).click()
  await expect(page.getByTestId('wallet-mnemonic')).toBeVisible({ timeout: 20_000 })
  const words = await page.getByTestId('wallet-mnemonic').locator('li').allInnerTexts()
  expect(words).toHaveLength(24)
  expect(words.every((w) => /^[a-z]+$/.test(w.trim()))).toBe(true)
  await page.screenshot({ path: `${SHOT}/23-wallet-mnemonic.png` })
  await page.getByRole('button', { name: /我记好了|Got it/ }).click()
  await expect(page.getByTestId('wallet-mnemonic')).toBeHidden()

  // --- 退出：面板里没有退出按钮，走首页木牌上的入口 ---
  await page.getByRole('button', { name: /^关闭$|^Close$/ }).click()
  await expect(page.getByTestId('wallet-modal')).toBeHidden()
  await logout(page)
  await expect(page.getByRole('button', { name: /^登录|Sign in/ }).first()).toBeVisible()

  // --- 登录：系统自己列出该域名下的通行密钥，回到同一个地址 ---
  await page.getByRole('button', { name: /^登录|Sign in/ }).first().click()
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
  expect(await readAddress(page)).toBe(address)
  // 登录不再领一次水
  expect(chain.faucetCalls()).toBe(1)

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
