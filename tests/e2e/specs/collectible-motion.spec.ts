import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { PAID_CARD_POOL } from '../../../src/race/cards/paidCards.ts'

test.use({ video: 'on' })

test('pony and rare rewards use their approved individual templates and the illustrated keep button', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [kind, id, template] of [[1, 5, 'front-pony-titled'], [0, 2, 'front-card-titled']] as const) {
    await page.goto('/tests/e2e/fixtures/collectible-result.html')
    await page.evaluate(() => window.collectibleFixture.language('zh'))
    await page.evaluate(([kind, id]) => window.collectibleFixture.confirm(kind, id), [kind, id])
    await page.getByRole('button', { name: '点击揭晓收藏' }).click()
    await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
    await expect.poll(() => page.locator('.collectible-front').evaluate(el => getComputedStyle(el).backgroundImage)).toContain(`${template}.webp`)
    await expect(page.locator('.collectible-keep img')).toHaveAttribute('src', '/assets/art/collectibles/keep-button.webp')
    await expect.poll(() => page.locator('.collectible-front img').evaluateAll(images => images.every(image =>
      (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    await page.locator('.collectible-panel').screenshot({ path: info.outputPath(`${template}.png`) })
  }
})

test('confirmed rewards wait on the back, spin once, celebrate, and stay revealed across rerenders', async ({ page }, info) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await page.evaluate(() => window.collectibleFixture.confirm())
  const panel = page.locator('.collectible-panel')
  await expect(panel).toHaveAttribute('data-reveal-phase', 'waiting')
  await expect(page.getByRole('button', { name: 'Reveal collectible' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'New rare card' })).toHaveCount(0)
  const box = await panel.boundingBox()
  expect(box!.width / box!.height).toBeCloseTo(2 / 3, 2)
  await page.screenshot({ path: info.outputPath('reward-back.png') })
  const breathPeak = page.evaluate(() => new Promise<number>(resolve => {
    let peak = 1
    const deadline = performance.now() + 9000
    const sample = () => {
      const panel = document.querySelector<HTMLElement>('.collectible-panel')!
      peak = Math.max(peak, new DOMMatrix(getComputedStyle(document.querySelector('.collectible-lift')!).transform).a)
      if (panel.dataset.revealPhase === 'revealed' || performance.now() > deadline) resolve(peak)
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  await page.getByRole('button', { name: 'Reveal collectible' }).click()
  await expect(panel).toHaveAttribute('data-reveal-phase', 'spinning')
  const spin = await page.locator('.collectible-rotation').evaluate(el => {
    const animation = el.getAnimations()[0]
    const effect = animation.effect as KeyframeEffect
    return { frames: effect.getKeyframes().map(frame => frame.transform), easing: effect.getTiming().easing,
      duration: effect.getTiming().duration }
  })
  // Eight full turns followed by the half-turn required to land on the front.
  expect(spin.frames).toEqual(['rotateY(180deg)', 'rotateY(3240deg)'])
  expect(spin.duration).toBeGreaterThan(2500)
  expect(spin.easing).not.toBe('linear')
  await page.evaluate(() => window.collectibleFixture.rerender())
  await expect(panel).toHaveAttribute('data-reveal-phase', 'spinning')
  await expect(page.locator('.collectible-confetti')).toHaveCount(0)
  await expect(panel).toHaveAttribute('data-reveal-phase', 'celebrating')
  await expect(page.locator('.collectible-confetti')).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('reward-celebration.png') })
  expect(await breathPeak).toBeGreaterThan(1.08)
  await expect(panel).toHaveAttribute('data-reveal-phase', 'revealed')
  await expect(page.getByRole('heading', { name: 'New rare card' })).toBeVisible()
  await expect(page.locator('[data-card="C-02"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await page.evaluate(() => { window.collectibleFixture.rerender(); window.collectibleFixture.language('zh') })
  await expect(panel).toHaveAttribute('data-reveal-phase', 'revealed')
  await expect(page.getByRole('heading', { name: '获得稀有卡' })).toBeVisible()
  await expect(page.locator('.collectible-confetti')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('reward-rare-front.png') })
  await page.getByRole('button', { name: '收下', exact: true }).click()
  await expect(panel).toHaveCount(0)
})

test('pony reveal fits a narrow viewport and honours system reduced motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await page.evaluate(() => window.collectibleFixture.confirm(1, 5))
  await page.getByRole('button', { name: 'Reveal collectible' }).press('Enter')
  const panel = page.locator('.collectible-panel')
  await expect(panel).toHaveAttribute('data-reveal-phase', 'revealed')
  await expect(page.getByRole('heading', { name: 'New pony' })).toBeVisible()
  await expect(page.locator('.collectible-confetti')).toHaveCount(0)
  const box = await panel.boundingBox()
  expect(box!.width / box!.height).toBeCloseTo(2 / 3, 2)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: info.outputPath('reward-pony-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(panel).toHaveAttribute('data-reveal-phase', 'revealed')
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(panel).toHaveCount(0)
})

test('the effect showcase uses the same reward reveal and reduced-motion setting', async ({ page }) => {
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await page.getByRole('button', { name: '特效验收', exact: true }).click()
  await page.getByRole('checkbox', { name: '减少动态效果' }).check()
  await page.getByRole('combobox', { name: '获得稀有卡' }).selectOption('C-40')
  await page.getByRole('button', { name: '预览获得稀有卡', exact: true }).focus()
  await page.getByRole('button', { name: '预览获得稀有卡', exact: true }).press('Enter')
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'waiting')
  await page.getByRole('button', { name: '点击揭晓收藏' }).click()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await expect(page.locator('[data-card="C-40"]')).toBeVisible()
  await page.getByRole('button', { name: '收下', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览获得稀有卡', exact: true })).toBeFocused()
})

test('reward dialogs contain no temporary animation status output', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await page.evaluate(() => window.collectibleFixture.confirm())
  await expect(page.getByTestId('collectible-dialog')).toBeVisible()
  await expect(page.getByTestId('collectible-dialog').locator('output')).toHaveCount(0)
})

test('every rare name fits one centered line in its scaled box in both languages', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  for (const card of PAID_CARD_POOL.filter(card => card.quality === 'rare')) {
    await page.reload()
    await page.evaluate(id => window.collectibleFixture.confirm(0, id), Number(card.cardId.slice(2)))
    await page.getByRole('button', { name: 'Reveal collectible' }).click()
    await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
    const face = page.locator(`[data-card="${card.cardId}"]`)
    for (const lang of ['en', 'zh'] as const) {
      await page.evaluate(lang => window.collectibleFixture.language(lang), lang)
      await expect(face.locator('.collectible-card-name')).toHaveText(card.name[lang])
      const sizes: { width: number; height: number; font: number }[] = []
      for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }, { width: 280, height: 400 }]) {
        await page.setViewportSize(viewport)
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await expect.poll(() => face.locator('.collectible-card-name').evaluate(el => {
          const box = el.getBoundingClientRect()
          const range = document.createRange(); range.selectNodeContents(el)
          const text = range.getBoundingClientRect()
          return text.width <= box.width + .5 && text.height <= box.height + .5 &&
            Math.abs(text.x + text.width / 2 - box.x - box.width / 2) < 1 &&
            Math.abs(text.y + text.height / 2 - box.y - box.height / 2) < 1 &&
            getComputedStyle(el).whiteSpace === 'nowrap'
        }), `${card.cardId} ${lang} at ${viewport.width}x${viewport.height}`).toBe(true)
        sizes.push(await face.locator('.collectible-card-name').evaluate(el => {
          const text = el.firstElementChild ?? el
          return { width: el.clientWidth, height: el.clientHeight, font: parseFloat(getComputedStyle(text).fontSize) }
        }))
      }
      expect(sizes[0]!.width).toBeGreaterThan(sizes[2]!.width)
      expect(sizes[0]!.height).toBeGreaterThan(sizes[2]!.height)
      expect(sizes[0]!.font).toBeGreaterThan(sizes[2]!.font)
      if (card.cardId === 'C-02') await page.locator('.collectible-panel').screenshot({ path: info.outputPath(`name-fit-${lang}-small.png`) })
    }
    await expect(face.locator('p')).toHaveCount(0)
    await expect(face).not.toContainText(card.desc.zh)
    await expect(face).not.toContainText(card.desc.en)
  }
})

test('Escape and scrim cannot interrupt rotation; keeping the revealed reward prevents a replay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await page.evaluate(() => window.collectibleFixture.confirm(1, 8))
  await page.getByRole('button', { name: 'Reveal collectible' }).click()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'spinning')
  await page.keyboard.press('Escape')
  await page.mouse.click(20, 20)
  await expect(page.getByTestId('collectible-dialog')).toBeVisible()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('collectible-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Keep it' }).click()
  await page.evaluate(() => window.collectibleFixture.rerender())
  await expect(page.getByTestId('collectible-dialog')).toHaveCount(0)
  await expect(page.locator('.collectible-confetti')).toHaveCount(0)
  expect(errors).toEqual([])
})
