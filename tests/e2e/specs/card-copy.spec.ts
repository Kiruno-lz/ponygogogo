import { expect, test } from '@playwright/test'
import { PAID_CARD_POOL } from '../../../src/race/cards/paidCards.ts'

test('all card faces separate meme and effect with spacing and keep copy inside the art', async ({ page }, info) => {
  await page.goto('/tests/e2e/fixtures/new-cards.html')
  await page.getByRole('button', { name: 'all cards', exact: true }).click()
  await expect(page.locator('.card-copy hr')).toHaveCount(0)
  for (const lang of ['zh', 'en'] as const) {
    await page.evaluate(() => document.fonts.ready)
    for (const def of PAID_CARD_POOL) {
      const card = page.locator(`.card-root[data-card="${def.cardId}"]`)
      await expect(card.locator('.card-meme')).toHaveText(def.meme[lang])
      await expect(card.locator('.card-effect')).toHaveText(def.desc[lang])
      await expect(card.locator('.card-copy')).toHaveCSS('white-space', 'pre-line')
      const gap = await card.evaluate(card => card.querySelector('.card-effect')!.getBoundingClientRect().top
        - card.querySelector('.card-meme')!.getBoundingClientRect().bottom)
      expect(gap).toBeGreaterThan(3)
    }
    const bounds = await page.locator('.card-root').evaluateAll(cards => cards.map(card => {
      const copy = card.querySelector('.card-copy')!.getBoundingClientRect()
      const art = card.querySelector(':scope > div')!.getBoundingClientRect()
      const name = card.querySelector('.card-name')!.getBoundingClientRect()
      const ribbon = card.querySelector('.card-name')!.parentElement!.getBoundingClientRect()
      return { card: card.getAttribute('data-card'), overflow: copy.bottom > art.bottom + 1 || copy.right > art.right + 1,
        nameOffset: name.y + name.height / 2 - ribbon.y - ribbon.height / 2 }
    }))
    expect(bounds.filter(card => card.overflow)).toEqual([])
    for (const card of bounds) expect(card.nameOffset).toBeCloseTo(11, 1)
    await page.screenshot({ path: info.outputPath(`card-copy-${lang}.png`), fullPage: true })
    if (lang === 'zh') await page.getByRole('button', { name: 'zh', exact: true }).click()
  }
})

test('an authored newline in the current meme copy starts a separate visual line', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/new-cards.html')
  await page.getByRole('button', { name: 'all cards', exact: true }).click()
  const multiline = PAID_CARD_POOL.find(card => card.meme.zh.includes('\n'))
  expect(multiline, 'The current Chinese copy includes an authored newline to verify').toBeDefined()
  await page.evaluate(() => document.fonts.ready)
  const lines = await page.locator(`[data-card="${multiline!.cardId}"] .card-meme`).evaluate(element => {
    const text = element.firstChild!
    const index = text.textContent!.indexOf('\n')
    if (index < 0) throw new Error('Missing authored newline')
    const position = (start: number) => {
      const range = document.createRange()
      range.setStart(text, start); range.setEnd(text, start + 1)
      return range.getBoundingClientRect().y
    }
    return { first: position(0), second: position(index + 1), lineHeight: parseFloat(getComputedStyle(element).lineHeight) }
  })
  expect(lines.second - lines.first).toBeGreaterThanOrEqual(lines.lineHeight - .5)
})
