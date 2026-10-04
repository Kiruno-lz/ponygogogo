import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1619, height: 971 })
  await page.goto('/tests/e2e/fixtures/pony-selection.html')
})

test('queue scrolling keeps flags fixed and submits visible roster with lower lane zero', async ({ page }) => {
  const flags = await page.locator('.lane-pennant').evaluateAll(items => items.map(el => el.getBoundingClientRect().top))
  await expect(page.getByTestId('pony-queue-up')).toBeDisabled()
  await page.getByTestId('pony-queue-down').click()
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  expect(await page.locator('.lane-pennant').evaluateAll(items => items.map(el => el.getBoundingClientRect().top))).toEqual(flags)
  await expect(page.getByTestId('horse-5')).toHaveAttribute('data-lane', '0')
  await page.getByTestId('horse-5').click()
  await page.locator('.select-race-cta button').click()
  await expect(page.getByTestId('entry-capture')).toHaveText('{"playerHorseId":0,"tier":0,"roster":[5,4,3,2,1]}')
})

test('keyboard moves ring alone in middle and queue alone at lower edge', async ({ page }) => {
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('horse-2')).toHaveAttribute('aria-pressed', 'true')
  const ring = page.getByTestId('selection-ring')
  const before = await ring.boundingBox()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'ring')
  await page.waitForTimeout(150)
  const middle = await ring.boundingBox()
  expect(middle!.y).toBeGreaterThan(before!.y)
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.getByTestId('horse-4').click()
  const edge = await ring.boundingBox()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'queueFixedRing')
  expect((await ring.boundingBox())!.y).toBeCloseTo(edge!.y, 1)
  await expect(page.getByTestId('horse-5')).toHaveAttribute('aria-pressed', 'true')
})

test('direct click has no ring transition and animation executes only latest pending input', async ({ page }) => {
  await page.getByTestId('horse-1').click()
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.getByTestId('pony-queue-down').click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await expect(page.getByTestId('horse-2')).toHaveAttribute('aria-pressed', 'true')
})

test('reduced motion reaches the final queue and selection without an animation wait', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-selection.html?reduced=1')
  await page.getByTestId('pony-queue-down').click()
  await expect(page.getByTestId('horse-5')).toHaveAttribute('data-lane', '0')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
})

test('上下队列使用明显的实心黄色箭头素材，禁用与键盘焦点仍可识别', async ({ page }, info) => {
  const up = page.getByTestId('pony-queue-up'), down = page.getByTestId('pony-queue-down')
  await expect(up.locator('img')).toHaveCount(1)
  await expect(down.locator('img')).toHaveCount(1)
  await expect(up.locator('img')).toHaveAttribute('src', '/assets/art/ui/queue-arrow-up.webp')
  const image = await up.locator('img').evaluate(el => ({ loaded: (el as HTMLImageElement).naturalWidth > 0,
    width: el.getBoundingClientRect().width }))
  expect(image.loaded).toBe(true)
  expect(image.width).toBeGreaterThanOrEqual(60)
  const alpha = await up.locator('img').evaluate(el => {
    const img = el as HTMLImageElement, canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return { corner: ctx.getImageData(0, 0, 1, 1).data[3],
      center: ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] }
  })
  expect(alpha.corner).toBe(0)
  expect(alpha.center).toBeGreaterThanOrEqual(250)
  await expect(up).toBeDisabled()
  await down.focus()
  await expect(down).toBeFocused()
  await expect(down).toBeEnabled()
  await page.screenshot({ path: info.outputPath('queue-arrows.png') })
  await down.click({ position: { x: 40, y: 55 } })
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await expect(up).toBeEnabled()
})

test('上箭头再上移8px，方向与端点禁用保持正确', async ({ page }) => {
  const up = page.getByTestId('pony-queue-up'), down = page.getByTestId('pony-queue-down')
  expect(await up.evaluate(el => parseFloat(getComputedStyle(el).top))).toBe(296)
  expect(await down.evaluate(el => parseFloat(getComputedStyle(el).top))).toBe(747)
  await expect(up).toBeDisabled()
  for (let i = 0; i < 4; i++) {
    await down.click()
    await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  }
  await expect(down).toBeDisabled()
  await expect(page.getByTestId('horse-8')).toHaveAttribute('data-lane', '0')
  await up.click()
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await expect(page.getByTestId('horse-7')).toHaveAttribute('data-lane', '0')
  await expect(down).toBeEnabled()
})

test('金圈与角色队列滚动及淡入淡出均为250ms', async ({ page }) => {
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('selection-ring')).toHaveCSS('transition-duration', '0.25s')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.getByTestId('pony-queue-down').click()
  await expect(page.getByTestId('selection-ring')).toHaveCSS('transition-duration', '0.25s')
  await expect(page.getByTestId('horse-3')).toHaveCSS('transition-duration', '0.25s, 0.25s')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.getByTestId('horse-5').click()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'queueFixedRing')
  await expect(page.getByTestId('horse-6')).toHaveCSS('transition-duration', '0.25s, 0.25s')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
})

test('方向键选马只显示金圈，不显示黄色圆角矩形焦点框', async ({ page }, info) => {
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const horse = page.getByTestId('horse-3')
  await expect(horse).toBeFocused()
  await expect(horse).toHaveAttribute('aria-pressed', 'true')
  await expect(horse).toHaveCSS('outline-style', 'none')
  await expect(page.getByTestId('selection-ring')).toBeVisible()
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.screenshot({ path: info.outputPath('keyboard-gold-ring-only.png') })
})

for (const reduced of [false, true]) test(`场外相邻角色无残留像素，场内五匹及金圈完整（reduced=${reduced}）`, async ({ page }, info) => {
  await page.goto(`/tests/e2e/fixtures/pony-selection.html${reduced ? '?reduced=1' : ''}`)
  const column = page.getByTestId('pony-selection-column')
  await page.getByTestId('horse-2').click()
  await page.mouse.move(900, 350)
  for (let window = 0; window <= 4; window++) {
    await expect(column).toHaveAttribute('data-motion', 'none')
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.querySelectorAll<HTMLElement>('.pony-portrait')).map(async el => {
        const image = new Image(); image.src = getComputedStyle(el).backgroundImage.slice(5, -2); await image.decode()
      }))
    })
    const actual = PNG.sync.read(await column.screenshot({ animations: 'disabled' }))
    const before = await column.locator('.horse-choice[aria-hidden="true"]').evaluateAll(nodes => nodes.map(node => {
      const el = node as HTMLElement, old = el.style.visibility
      el.style.visibility = 'hidden'
      return { id: el.dataset.testid!, visibility: old }
    }))
    const withoutNeighbours = PNG.sync.read(await column.screenshot({ animations: 'disabled' }))
    await page.evaluate(items => items.forEach(item => {
      document.querySelector<HTMLElement>(`[data-testid="${item.id}"]`)!.style.visibility = item.visibility
    }), before)
    expect(actual.data.equals(withoutNeighbours.data), `window=${window}: adjacent actors must paint zero pixels`).toBe(true)
    await expect(column.locator('.horse-choice[aria-hidden="false"]')).toHaveCount(5)
    const intact = await column.evaluate(el => {
      const bounds = el.getBoundingClientRect()
      return Array.from(el.querySelectorAll<HTMLElement>('.horse-choice[aria-hidden="false"] .pony-portrait, .selection-ground-ring')).every(art => {
        const r = art.getBoundingClientRect()
        return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom
      })
    })
    expect(intact).toBe(true)
    if (window === 0 || window === 4) await page.screenshot({ path: info.outputPath(`queue-window-${window}.png`), animations: 'disabled' })
    if (window < 4) {
      await page.getByTestId('pony-queue-down').click()
      await page.mouse.move(900, 350)
    }
  }
})
