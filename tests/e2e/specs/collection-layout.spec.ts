import { expect, test } from '@playwright/test'

test('gallery cards and masks scale together to 90 percent and leave space below the icon', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  await page.evaluate(() => document.fonts.ready)
  const sizes = await page.locator('[data-card]').evaluateAll(cards => cards.map(card => {
    const bounds = card.getBoundingClientRect()
    const copy = card.querySelector('.card-copy')
    const icon = card.querySelector(':scope > div > img')
    return { width: bounds.width, height: bounds.height, rareFace: card.classList.contains('card-root') && card.getAttribute('data-quality') === 'rare',
      gap: copy && icon ? copy.getBoundingClientRect().top - icon.getBoundingClientRect().bottom : null }
  }))
  expect(sizes.length).toBe(40)
  for (const card of sizes) {
    expect(card.width).toBeCloseTo(261, 1)
    expect(card.height).toBeCloseTo(card.rareFace ? 367 : 351, 1)
    if (card.gap !== null) expect(card.gap).toBeGreaterThanOrEqual(12.1)
  }
})

test('collection raises the fade boundary with a negative margin and halves first-row padding', async ({ page }) => {
  await page.setViewportSize({ width: 1619, height: 971 })
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  const heading = await page.locator('.collection-heading').boundingBox()
  expect(heading!.x).toBeGreaterThanOrEqual(246)
  expect(heading!.y).toBeGreaterThanOrEqual(74)
  expect((await page.getByRole('tablist').boundingBox())!.y).toBeCloseTo(77, 1)
  const panel = page.locator('#collection-panel-cards')
  const bounds = await panel.boundingBox()
  const header = (await page.locator('header').boundingBox())!
  expect(bounds!.y).toBeCloseTo(header.y + header.height - 14, 1)
  await expect(panel).toHaveCSS('margin-top', '-14px')
  await expect(panel).toHaveCSS('padding-top', '28px')
  expect(bounds!.x).toBeGreaterThanOrEqual(60)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1559)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(919)
  const mask = await panel.evaluate(element => getComputedStyle(element).maskImage)
  expect(mask).toContain('30px')
  expect(mask).toContain('rgba(0, 0, 0, 0)')
  expect(mask).toMatch(/rgba\(0, 0, 0, 0\) 0px, rgb\(0, 0, 0\) 30px/)
  const unlock = page.getByRole('button', { name: '读取收藏', exact: true })
  const back = (await page.getByRole('button', { name: '返回', exact: true }).boundingBox())!
  expect((await unlock.boundingBox())!.x).toBeGreaterThan(back.x + back.width)
  expect((await unlock.boundingBox())!.x + (await unlock.boundingBox())!.width).toBeLessThan((await page.getByRole('tablist').boundingBox())!.x)
  await expect(page.locator('header').getByRole('heading')).toHaveCount(0)
  await expect(page.locator('header')).not.toContainText('共 40 张')
  await expect(page.getByTestId('screen-collection')).toHaveCSS('background-image', /art\/collection\/background\.webp/)
})

test('rare card grows sixteen pixels upwards while sharing the common card bottom edge', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  const common = (await page.locator('.card-root[data-card="C-01"]').boundingBox())!
  const rare = (await page.locator('.card-root[data-card="C-02"]').boundingBox())!
  expect(rare.height - common.height).toBeCloseTo(16, 1)
  expect(common.y - rare.y).toBeCloseTo(16, 1)
  expect(rare.y + rare.height).toBeCloseTo(common.y + common.height, 1)
  const panel = (await page.locator('#collection-panel-cards').boundingBox())!
  expect(rare.y - panel.y).toBeCloseTo(12, 1)
})

test('both wooden toolbar buttons scale their background and label together to 70 percent', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  await page.evaluate(() => document.fonts.ready)
  const scales = await page.locator('.collection-header .btn-wood').evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect(), label = button.querySelector('.zh')! as HTMLElement
    // offsetHeight rounds the unscaled line box to an integer; resolved CSS sizes retain its fraction.
    const boxStyle = getComputedStyle(button), labelStyle = getComputedStyle(label)
    return { width: bounds.width / parseFloat(boxStyle.width), height: bounds.height / parseFloat(boxStyle.height),
      label: label.getBoundingClientRect().height / parseFloat(labelStyle.height) }
  }))
  expect(scales).toHaveLength(2)
  for (const scale of scales) for (const ratio of Object.values(scale)) expect(ratio).toBeCloseTo(.7, 2)
  await expect(page.getByRole('button', { name: '读取收藏', exact: true })).toBeEnabled()
})

test('toolbar buttons, switch and filters remain separate without titles or counts in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 1619, height: 971 })
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  for (const lang of ['zh', 'en']) {
    if (lang === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    const layout = await page.locator('header').evaluate(header => {
      const tabs = header.querySelector('.collection-tabs')!.getBoundingClientRect()
      const buttons = header.querySelectorAll('.btn-wood')
      const back = buttons[0]!.getBoundingClientRect(), unlock = buttons[1]!.getBoundingClientRect()
      const filters = header.querySelector('.collection-tools')!.firstElementChild!.getBoundingClientRect()
      return { backEnd: back.right, unlockStart: unlock.left, unlockEnd: unlock.right, switchStart: tabs.left,
        switchEnd: tabs.right, filterStart: filters.left }
    })
    expect(layout.backEnd, lang).toBeLessThanOrEqual(layout.unlockStart)
    expect(layout.unlockEnd, lang).toBeLessThanOrEqual(layout.switchStart)
    expect(layout.switchEnd, lang).toBeLessThanOrEqual(layout.filterStart)
    await expect(page.locator('header').getByRole('heading')).toHaveCount(0)
    await expect(page.locator('header')).not.toContainText(lang === 'zh' ? '共 40 张' : '40 cards')
  }
})

test('the segmented switch stays centered in the top bar and slides between both categories', async ({ page }, info) => {
  await page.setViewportSize({ width: 1619, height: 971 })
  await page.goto('/tests/e2e/fixtures/pony-gallery.html')
  const tabs = page.getByRole('tablist')
  const centered = await tabs.evaluate(element => {
    const bar = element.closest('header')
    if (!bar) return false
    const a = bar.getBoundingClientRect(), b = element.getBoundingClientRect()
    return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1
  })
  expect(centered).toBe(true)
  const thumb = tabs.locator('.collection-tab-thumb')
  const initial = await thumb.boundingBox()
  await page.getByRole('tab', { name: '小马', exact: true }).click()
  await expect(page.getByRole('tab', { name: '小马', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#collection-panel-ponies')).toBeVisible()
  await expect.poll(async () => (await thumb.boundingBox())!.x - initial!.x).toBeCloseTo(initial!.width, 0)
  await page.getByRole('tab', { name: '小马', exact: true }).press('ArrowLeft')
  await expect(page.getByRole('tab', { name: '卡牌', exact: true })).toBeFocused()
  await expect(page.locator('#collection-panel-cards')).toBeVisible()
  await expect.poll(async () => (await thumb.boundingBox())!.x).toBeCloseTo(initial!.x, 0)
  for (const asset of ['/assets/art/collection/tabs-track.webp', '/assets/art/collection/tabs-thumb.webp']) {
    expect((await page.request.get(asset)).headers()['content-type']).toContain('image/webp')
  }
  await page.screenshot({ path: info.outputPath('collection.png'), fullPage: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(thumb).toHaveCSS('transition-duration', '0s')
})
