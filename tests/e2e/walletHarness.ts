/**
 * 钱包用例的共用装置：带 PRF 的虚拟认证器 + 假链假水龙头。
 * 跑的是真实的 mera 代码路径，但不打真实测试网、不消耗水龙头额度。
 */
import { expect, type Page } from '@playwright/test'

export const ONE_MON = 10n ** 18n

/** 装一个带 PRF 扩展的 CDP 虚拟认证器 */
export async function addAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  })
}

/**
 * 拦下 RPC 与水龙头。
 * `fund: false` 让水龙头照常受理却永不入账——注册里的余额轮询会一直跑到跑满，
 * 这正是「领水还没结束」那段时间窗口，用来验证那期间的界面状态。
 */
export async function stubChain(
  page: Page,
  { fund = true }: { fund?: boolean } = {},
): Promise<{ faucetCalls: () => number }> {
  const balances = new Map<string, bigint>()
  let faucetCalls = 0

  await page.route(
    (url) => url.hostname.endsWith('devnads.com'),
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { address?: string }
      faucetCalls++
      if (fund && body.address) balances.set(body.address.toLowerCase(), ONE_MON)
      await route.fulfill({ status: 200, body: 'queued' })
    },
  )

  await page.route(
    (url) => url.hostname.endsWith('monad.xyz'),
    async (route) => {
      const req = JSON.parse(route.request().postData() ?? '{}') as {
        id: number
        method: string
        params?: unknown[]
      }
      let result = '0x0'
      if (req.method === 'eth_getBalance') {
        const addr = String(req.params?.[0] ?? '').toLowerCase()
        result = `0x${(balances.get(addr) ?? 0n).toString(16)}`
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }),
      })
    },
  )

  return { faucetCalls: () => faucetCalls }
}

/** 点注册 → 在取名窗口填名字 → 确认，直到钱包牌子出现 */
export async function registerAs(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /^注册|Sign up/ }).first().click()
  await expect(page.getByTestId('register-modal')).toBeVisible()
  await page.getByTestId('register-name').fill(name)
  await page.getByRole('button', { name: /创建通行密钥|Create passkey/ }).click()
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
}

/** 读出当前账户的完整地址，读完把面板收起来 */
export async function readAddress(page: Page): Promise<string> {
  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-modal')).toBeVisible()
  const address = (await page.getByTestId('wallet-address').innerText()).trim()
  await page.getByRole('button', { name: /^关闭$|^Close$/ }).click()
  await expect(page.getByTestId('wallet-modal')).toBeHidden()
  return address
}

/** 退出登录：入口在首页木牌上，钱包面板里没有这个按钮 */
export async function logout(page: Page): Promise<void> {
  await page.getByTestId('wallet-logout').click()
  await expect(page.getByTestId('wallet-panel')).toBeHidden()
}
