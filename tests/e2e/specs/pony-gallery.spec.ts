import { expect, test } from '@playwright/test'
import { ponyAbilityText } from '../../../src/ui/shared/ponyAbilityText.ts'

test('pony panels enlarge to 120 percent with three columns, wider gaps and no divider', async ({ page }, info) => {
  await page.setViewportSize({ width: 1619, height: 971 })
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  const cards = (await page.locator('#collection-panel-cards').boundingBox())!
  await page.getByRole('tab', { name: '小马', exact: true }).click()
  await expect(page.locator('.pony-gallery')).toHaveCSS('padding-top', '28px')
  const ponies = (await page.locator('#collection-panel-ponies').boundingBox())!
  expect(ponies.x).toBeCloseTo(cards.x, 1)
  expect(ponies.width).toBeCloseTo(cards.width, 1)
  const firstPony = (await page.locator('[data-pony="0"]').boundingBox())!
  expect(firstPony.width).toBe(360)
  expect(firstPony.height).toBe(480)
  expect(firstPony.x).toBeGreaterThanOrEqual(ponies.x + 24)
  expect(firstPony.x + firstPony.width).toBeLessThanOrEqual(ponies.x + ponies.width - 24)
  await expect(page.locator('.pony-strategy')).toHaveCount(0)
  await expect(page.locator('.pony-gallery hr')).toHaveCount(0)
  const boxes = await page.locator('[data-pony]').evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect()
    return { x, y, width, height }
  }))
  for (let row = 0; row < 3; row++) {
    const first = boxes[row * 3]!
    for (let column = 1; column < 3; column++) {
      const box = boxes[row * 3 + column]!, previous = boxes[row * 3 + column - 1]!
      expect(box.y).toBeCloseTo(first.y, 1)
      expect(box.x - previous.x - previous.width).toBeCloseTo(40, 1)
    }
    if (row) expect(first.y - boxes[(row - 1) * 3]!.y - first.height).toBeCloseTo(40, 1)
  }
  const image = await page.request.get('/assets/art/collection/pony-panel.webp')
  expect(image.headers()['content-type']).toContain('image/webp')
  for (const lang of ['zh', 'en'] as const) {
    if (lang === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    for (let id = 0; id < 9; id++) {
      const pony = page.locator(`[data-pony="${id}"]`)
      await expect(pony).toContainText(ponyAbilityText(id, lang).description)
      if (!ponyAbilityText(id, lang).name) await expect(pony.locator('h3')).toHaveCount(0)
      await expect(pony).toHaveCSS('background-image', /art\/collection\/pony-panel\.webp/)
      await expect(pony).toHaveCSS('height', '400px')
      const textLayout = await pony.locator('h2, .pony-gallery-header span, h3, p, small').evaluateAll(elements =>
        elements.map(element => ({ align: getComputedStyle(element).textAlign, left: element.getBoundingClientRect().left })))
      expect(textLayout.every(text => text.align === 'left')).toBe(true)
      expect(textLayout.every(text => Math.abs(text.left - textLayout[0]!.left) < 1)).toBe(true)
      const content = await pony.evaluate(card => {
        const image = card.querySelector('.pony-gallery-image')!
        const header = card.querySelector('.pony-gallery-header')!
        const cardStyle = getComputedStyle(card), scale = parseFloat(cardStyle.zoom)
        return { inset: (header.getBoundingClientRect().left - card.getBoundingClientRect().left) / scale
          - parseFloat(cardStyle.paddingLeft), portraitHeight: image.getBoundingClientRect().height / scale }
      })
      expect(content.inset).toBeCloseTo(6, 1)
      expect(content.portraitHeight).toBeCloseTo(150, 1)
      await expect(pony.locator('h2')).toHaveCSS('margin-top', '12px')
      await expect(pony.locator('h2')).toHaveCSS('font-size', '21px')
      await expect(pony.locator('p')).toHaveCSS('font-size', '13px')
      if (id >= 5) await expect(pony.locator('small')).toHaveCSS('font-size', '12px')
      const title = await pony.locator('h2').evaluate(element => ({
        height: element.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      }))
      expect(title.height).toBeCloseTo(title.lineHeight * 1.2, 1)
    }
    await expect(page.locator('.pony-gallery')).not.toContainText(lang === 'zh' ? '稀有优先，刷新找稀有' : 'Rare cards and refreshes')
    const clipped = await page.locator('.pony-gallery-card').evaluateAll(cards => cards.filter(card =>
      [...card.querySelectorAll('h2, h3, p, small')].some(text => {
        const a = text.getBoundingClientRect(), b = card.getBoundingClientRect()
        const style = getComputedStyle(card)
        const scale = parseFloat(style.zoom)
        return a.left < b.left + parseFloat(style.paddingLeft) * scale - 1
          || a.right > b.right - parseFloat(style.paddingRight) * scale + 1
          || a.bottom > b.bottom - parseFloat(style.paddingBottom) * scale + 1
          || text.scrollWidth > text.clientWidth + 1
      })).map(card => card.getAttribute('data-pony')))
    expect(clipped).toEqual([])
    await page.screenshot({ path: info.outputPath(`pony-gallery-${lang}.png`) })
  }
})

test('pony gallery distinguishes unread, collected and default roles in both languages', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  await page.getByRole('tab', { name: '小马', exact: true }).click()
  await expect(page.locator('[data-pony]')).toHaveCount(9)
  await expect(page.locator('[data-pony="7"]')).toContainText('进度未读取')
  await expect(page.locator('.pony-gallery')).not.toContainText('默认开放')
  await expect(page.locator('[data-pony="0"] .pony-gallery-header span')).toHaveCount(0)
  await page.getByRole('button', { name: '读取收藏', exact: true }).click()
  await expect(page.locator('[data-pony="5"]')).toHaveAttribute('data-owned', 'true')
  await expect(page.locator('[data-pony="8"]')).toContainText('已获得')
  await expect(page.locator('[data-pony="6"]')).toContainText('未获得')
  await expect(page.locator('[data-pony="5"]')).toContainText(ponyAbilityText(5, 'zh').description)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('[data-pony="8"]')).toContainText('Collected')
  await expect(page.locator('[data-pony="6"]')).toContainText('Not collected')
  await expect(page.locator('.pony-gallery')).not.toContainText('Available by default')
  await expect(page.locator('[data-pony="0"] .pony-gallery-header span')).toHaveCount(0)
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
