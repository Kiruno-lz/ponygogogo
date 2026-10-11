import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, registerAs, stubChain } from '../walletHarness.ts'

// Override only this browser's indexer build variable. The rest of the isolated wallet environment stays intact.
test('wallet history fits eleven rows and scrolls through all pages without moving the panel', async ({ page }) => {
  const endpoint = 'http://localhost:5180/history-test/graphql'
  await page.route(/\/src\/chain\/history\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch()
    const body = await response.text()
    expect(body).toMatch(/"VITE_ENVIO_GRAPHQL_URL":\s*""/)
    await route.fulfill({ response, body: body.replace(/"VITE_ENVIO_GRAPHQL_URL":\s*""/, `"VITE_ENVIO_GRAPHQL_URL":"${endpoint}"`) })
  })
  let count = 11
  const pages: Array<{ limit: number; before: object }> = []
  await page.route(endpoint, async route => {
    const { before, limit } = route.request().postDataJSON().variables
    pages.push({ limit, before })
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `0x${(1000 - i).toString(16).padStart(64, '0')}`, horseId: 2, roster: [0, 1, 2, 3, 4],
      stake: '300000000000000000', state: 'SETTLED', openedAt: '1790571226', openedBlock: '66319820',
      openTx: `0x${'11'.repeat(32)}`, playerSettlementRank: 1, playerRawRank: 2,
      finishTime: [54156, 57473, 60923, 51058, 59953],
      payout: '900000000000000000', net: '600000000000000000', forfeitReason: null,
      closedAt: '1790571400', closeTx: `0x1234${'a'.repeat(56)}abcd`, choices: [],
    }))
    const eligible = before._or ? rows.filter(r => r.id < before._or[1].id._lt) : rows
    await route.fulfill({ json: { data: { Session: eligible.slice(0, limit), _meta: [] } } })
  })
  await addAuthenticator(page)
  await stubChain(page)
  await open(page)
  await enterHome(page)
  await registerAs(page, '战绩滚动测试')
  await page.getByTestId('wallet-open').click()
  const rows = page.getByTestId('wallet-history-row')
  const list = page.getByTestId('wallet-history').locator('ol')
  await expect(rows).toHaveCount(11)
  const spacing = await rows.first().evaluate(el => {
    const cells = [...el.children] as HTMLElement[]
    const name = document.createRange()
    name.selectNodeContents(cells[1]!)
    const scale = el.getBoundingClientRect().width / el.clientWidth
    return {
      afterName: (cells[2]!.getBoundingClientRect().left - name.getBoundingClientRect().right) / scale,
      padding: getComputedStyle(el.closest('.wallet-history')!).paddingRight,
      clipped: cells.some(cell => cell.scrollWidth > cell.clientWidth + 1),
    }
  })
  expect(spacing.afterName).toBeLessThan(120)
  expect(spacing.padding).toBe('12px')
  expect(spacing.clipped).toBe(false)
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(false)
  await expect(rows.first().locator('span').nth(4)).toHaveText('第 1 名')
  await expect(rows.first().locator('span').last()).toHaveText('60.92 s')
  const tx = rows.first().getByRole('link')
  await expect(tx).toHaveText('0x1234...abcd')
  await expect(tx).toHaveAttribute('href', 'https://testnet.monadexplorer.com/tx/0x1234' + 'a'.repeat(56) + 'abcd')
  await expect(page.getByTestId('wallet-history-payout')).toHaveText('累积返还 9.9 MON')
  await page.keyboard.press('Escape')

  count = 63
  pages.length = 0
  await page.getByTestId('wallet-open').click()
  await expect(rows).toHaveCount(63)
  await expect(page.getByTestId('wallet-history-payout')).toHaveText('累积返还 56.7 MON')
  expect(pages.filter(p => Object.keys(p.before).length > 0)).toHaveLength(1)
  expect(pages.every(p => p.limit === 50)).toBe(true)
  const panel = page.locator('.wallet-modal')
  const box = await panel.boundingBox()
  const metrics = await list.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight, row: el.firstElementChild!.getBoundingClientRect().height, scale: el.getBoundingClientRect().height / el.clientHeight }))
  expect(metrics.height).toBe(284)
  expect(metrics.scroll).toBeGreaterThan(metrics.height)
  expect(metrics.height * metrics.scale / metrics.row).toBeLessThan(12)
  await page.screenshot({ path: 'tests/e2e/screenshots/wallet-history-top.png' })
  await list.hover()
  await page.mouse.wheel(0, 4000)
  await expect.poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true)
  await expect(rows.last()).toBeInViewport()
  expect(await panel.boundingBox()).toEqual(box)
  await page.screenshot({ path: 'tests/e2e/screenshots/wallet-history-bottom.png' })
  await list.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wallet-modal')).toBeHidden()
  await expect(page.getByTestId('wallet-open')).toBeFocused()
})
