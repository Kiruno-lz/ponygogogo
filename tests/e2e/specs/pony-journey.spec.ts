import { expect, test } from '@playwright/test'
import { enterHome, playUntilResult } from '../helpers.ts'

test.use({ viewport: { width: 1640, height: 1050 } })

async function selectNewRole(page: import('@playwright/test').Page, id: number) {
  await page.goto('/tests/e2e/fixtures/pony-journey.html?raceSpeed=40')
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '队列上移', exact: true }).click()
  await page.getByTestId(`horse-${id}`).click()
  await page.locator('button.btn-star').last().click()
}

for (const [id,name] of [[5,'牛来'],[6,'啥马'],[7,'奶龙'],[8,'咕咕嘎嘎']] as const) {
  test(`${name} completes real roster practice and generates its own share poster`, async ({ page }) => {
    const running: string[] = []
    page.on('request', r => { if (/\/ponies\/\d+-running\.webp/.test(r.url())) running.push(r.url()) })
    await selectNewRole(page,id)
    await page.waitForFunction(() => (window as any).ponyJourneyReady === true)
    await expect(page.getByTestId('screen-race')).toBeVisible()
    await playUntilResult(page)
    await expect(page.locator('.result-hero')).toHaveAttribute('src', `/assets/art/result/hero-${id}.webp`)
    expect([...new Set(running.map(url => Number(/(\d+)-running/.exec(url)![1])))].sort()).toEqual([4,5,6,7,8])
    await page.getByRole('button', { name: /分享|Share/ }).first().click()
    await expect(page.getByTestId('share-poster')).toHaveAttribute('src', /^blob:/)
    await page.screenshot({ path: `.cache/pony-build/pony-${id}-share.png` })
  })
}

test('a participant image failure offers retry and does not advance the unseen practice race', async ({ page }) => {
  await page.route('**/art/ponies/7-running.webp', route => route.fulfill({status:404,body:''}))
  await selectNewRole(page,8)
  await expect(page.getByTestId('tier-gate-error')).toContainText('7-running.webp')
  expect(await page.evaluate(() => (window as any).ponyJourneyDriver.elapsedWallMs)).toBe(0)
  await page.unroute('**/art/ponies/7-running.webp')
  await page.getByRole('button', { name: /重试失败项|Retry failed items/ }).click()
  await page.waitForFunction(() => (window as any).ponyJourneyReady === true)
  await expect(page.getByTestId('tier-gate-error')).toHaveCount(0)
})

test('home prefetch leaves role-specific images for the page that uses them', async ({ page }) => {
  const character: string[] = []
  page.on('request', r => { if (/\/(ponies\/\d+-|result\/hero-\d|share\/horse-\d)/.test(r.url())) character.push(r.url()) })
  const prefetched = page.waitForResponse(r => r.url().endsWith('/art/share/prize-group.webp'))
  await page.goto('/')
  await enterHome(page)
  await prefetched
  expect(character).toEqual([])
})
