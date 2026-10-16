import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, registerAs } from '../walletHarness.ts'
import { stubChain } from '../walletHarness.ts'

test('manual collection read completes without a false error and updates the home count', async ({ page }) => {
  await addAuthenticator(page)
  await stubChain(page)
  let document: { version: number; envelope: unknown } | null = null
  await page.route('**/api/collection**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/challenge')) return route.fulfill({ json: { challenge: 'ab'.repeat(32), challengeId: crypto.randomUUID(), expiresAt: Date.now() + 120000 } })
    if (path.endsWith('/read')) return route.fulfill(document ? { json: document } : { status: 404, json: { error: 'COLLECTION_NOT_FOUND' } })
    const payload = route.request().postDataJSON().payload
    document = { version: payload.expectedVersion + 1, envelope: payload.envelope }
    return route.fulfill({ json: { version: document.version } })
  })
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await registerAs(page, 'collection test')
  await page.getByRole('button', { name: /卡牌图鉴/ }).click()
  await page.getByRole('button', { name: '读取收藏', exact: true }).click()
  await expect(page.getByRole('button', { name: '读取收藏', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByTestId('wallet-panel')).toContainText('27 / 40')
})

test('chain ownership can be refreshed when the private backup API is unavailable', async ({ page }) => {
  const game = '0x1111111111111111111111111111111111111111'
  const ledger = '0x2222222222222222222222222222222222222222'
  await addAuthenticator(page)
  await stubChain(page)
  // Serve the actual app with a configured Game, while all RPC traffic remains intercepted locally.
  await page.route('**/src/chain/network.ts', async route => {
    const original = await route.fetch()
    await route.fulfill({ response: original, body: (await original.text()).replace(/"VITE_PONY_GAME_ADDRESS"\s*:\s*""/, `"VITE_PONY_GAME_ADDRESS":"${game}"`) })
  })
  let mask = 1n << 2n
  let readsFail = false
  await page.route(url => url.hostname.endsWith('monad.xyz'), async route => {
    const req = route.request().postDataJSON()
    if (req.method !== 'eth_call') return route.fallback()
    const to = req.params[0].to.toLowerCase()
    if (to === ledger && readsFail) return route.fulfill({ json: { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'ownership unavailable' } } })
    const result = to === ledger ? `0x${mask.toString(16).padStart(64, '0')}` : `0x${ledger.slice(2).padStart(64, '0')}`
    await route.fulfill({ json: { jsonrpc: '2.0', id: req.id, result } })
  })
  let backupCalls = 0
  await page.route('**/api/collection**', route => { backupCalls++; return route.fulfill({ status: 503, body: 'unavailable' }) })
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await registerAs(page, 'chain collection')
  await expect(page.getByTestId('collection-count')).toHaveText('28 / 40')
  mask |= (1n << 21n) | (1n << 72n)
  await page.getByRole('button', { name: /卡牌图鉴/ }).click()
  await page.getByRole('button', { name: '读取收藏', exact: true }).click()
  await expect(page.locator('[data-pony="8"]')).toHaveAttribute('data-owned', 'true')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(backupCalls).toBe(0)
  readsFail = true
  await page.getByRole('button', { name: '读取收藏', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('未能读取链上收藏，请重试。')
  readsFail = false
  await page.getByRole('button', { name: '读取收藏', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByTestId('collection-count')).toHaveText('29 / 40')
})
