import { expect, test } from '@playwright/test'

test('pony gallery distinguishes unread, collected and default roles in both languages', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  await page.getByRole('tab', { name: '小马', exact: true }).click()
  await expect(page.locator('[data-pony]')).toHaveCount(9)
  await expect(page.locator('[data-pony="7"]')).toContainText('进度未读取')
  await expect(page.locator('[data-pony="0"]')).toContainText('默认开放')
  await page.getByRole('button', { name: '读取收藏', exact: true }).click()
  await expect(page.locator('[data-pony="5"]')).toHaveAttribute('data-owned', 'true')
  await expect(page.locator('[data-pony="8"]')).toContainText('已获得')
  await expect(page.locator('[data-pony="6"]')).toContainText('未获得')
  await expect(page.locator('[data-pony="5"]')).toContainText('+20%')
  await expect(page.locator('[data-pony="5"]')).toContainText('+100')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('[data-pony="8"]')).toContainText('Collected')
  await expect(page.locator('[data-pony="6"]')).toContainText('Not collected')
})

test('card filter and the two scroll positions survive switching gallery tabs', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  await page.getByRole('button', { name: '普通', exact: true }).click()
  const cards = page.locator('#collection-panel-cards'), ponies = page.locator('#collection-panel-ponies')
  await cards.evaluate(element => { element.scrollTop = 410 })
  await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBe(410)
  await page.getByRole('tab', { name: '小马', exact: true }).click()
  await ponies.evaluate(element => { element.scrollTop = 230 })
  await expect.poll(() => ponies.evaluate(element => element.scrollTop)).toBe(230)
  await page.getByRole('tab', { name: '卡牌', exact: true }).click()
  await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBe(410)
  await expect(page.getByRole('button', { name: '普通', exact: true })).toHaveClass(/on/)
  await page.getByRole('tab', { name: '卡牌', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: '小马', exact: true })).toBeFocused()
  await expect.poll(() => ponies.evaluate(element => element.scrollTop)).toBe(230)
})

test('all nine real sprite sheets decode eight complete transparent frames', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  const sheets = await page.evaluate(async () => {
    const out = []
    for (let pony = 0; pony < 9; pony++) for (const action of ['idle','running']) {
      const image = new Image()
      image.src = `/assets/art/ponies/${pony}-${action}.webp`
      await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192
      const ctx = canvas.getContext('2d')!
      const frames = []
      for (let frame = 0; frame < 8; frame++) {
        ctx.clearRect(0,0,256,192); ctx.drawImage(image,frame*256,0,256,192,0,0,256,192)
        const rgba = ctx.getImageData(0,0,256,192).data
        let ink = 0, edge = 0
        for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) if (rgba[(y*256+x)*4+3]! > 128) {
          ink++; if (x === 0 || x === 255 || y === 0 || y === 191) edge++
        }
        frames.push({ink,edge})
      }
      out.push({pony,action,width:image.naturalWidth,height:image.naturalHeight,frames})
    }
    return out
  })
  expect(sheets).toHaveLength(18)
  for (const sheet of sheets) {
    expect(sheet.width, `${sheet.pony}-${sheet.action}`).toBe(2048)
    expect(sheet.height).toBe(192)
    for (const frame of sheet.frames) { expect(frame.ink).toBeGreaterThan(500); expect(frame.edge).toBe(0) }
  }
})
