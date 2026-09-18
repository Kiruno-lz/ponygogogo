/**
 * L3-R：注册后的领水轮询要跑十几秒，那段时间里退出登录，首页的登录与注册按钮
 * 不能是灰的。缺陷说明见同目录 REPRO.md。
 */
import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, logout, registerAs, stubChain } from '../walletHarness.ts'

test('BUSY_STUCK：领水轮询未结束时退出，登录与注册仍可点', async ({ page }) => {
  await addAuthenticator(page)
  // 水龙头照常受理却永不入账：注册内部的余额轮询会一直跑到跑满，
  // 于是「钱包已经出现、但注册这次调用还没落地」的窗口被拉到十几秒，稳定可测。
  await stubChain(page, { fund: false })

  await open(page)
  await enterHome(page)
  await registerAs(page, 'ponygogogo')

  // 余额还停在占位符，说明轮询确实还在跑
  await expect(page.getByTestId('balance')).toHaveText('—')

  await logout(page)

  const login = page.getByRole('button', { name: /^登录|Sign in/ }).first()
  const register = page.getByRole('button', { name: /^注册|Sign up/ }).first()
  await expect(login).toBeVisible()
  // 一次性判定，不能用会自动重试的 toBeEnabled()——那会一路等到轮询自己结束，
  // 于是缺陷版本也「通过」，脚本就白写了
  expect(await login.isEnabled()).toBe(true)
  expect(await register.isEnabled()).toBe(true)

  // 真的能再走一次：按下注册要弹出取名窗口，而不是毫无反应
  await register.click()
  await expect(page.getByTestId('register-modal')).toBeVisible({ timeout: 3_000 })
})

test('BUSY_STUCK：退出之后，在途的领水结果不得再往界面上写', async ({ page }) => {
  await addAuthenticator(page)
  await stubChain(page, { fund: false })

  await open(page)
  await enterHome(page)
  await registerAs(page, 'ponygogogo')
  await expect(page.getByTestId('notice')).toBeHidden()
  await logout(page)

  // 轮询跑满（15 次 × 1s）之后，那次注册的领水提示不能再冒出来：
  // 玩家已经退出，这条结果属于一个不存在的会话。
  // 同样必须是一次性判定——提示自己 5.2 秒后会消失，会重试的断言等一等就「通过」了
  await page.waitForTimeout(16_000)
  expect(await page.getByTestId('notice').isVisible()).toBe(false)
  expect(await page.getByTestId('wallet-panel').isVisible()).toBe(false)
})
