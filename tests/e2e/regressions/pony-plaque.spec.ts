import { expect, test } from '@playwright/test'

// Normalized bounds measured on the accepted source images: forehead, muzzle
// and cheek, excluding mane/horns/body. Independent of the CSS layout values.
const PORTRAIT_FACES = [
  [122/256, 95/256, 250/256, 221/256], [580/1254, 482/1254, 1207/1254, 976/1254], [126/256, 65/256, 249/256, 183/256],
  [126/256, 65/256, 225/256, 165/256], [138/256, 64/256, 238/256, 176/256], [548/1254, 265/1254, 1254/1254, 1068/1254],
  [590/1254, 395/1254, 1254/1254, 1050/1254], [500/1254, 170/1254, 1205/1254, 951/1254], [514/1254, 514/1254, 1100/1254, 1020/1254],
] as const

test('portrait faces match Kiruno size and focal position inside the shared frame', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-selection.html?reduced=1')
  const faces: { width: number; height: number; x: number; y: number }[] = []
  for (let id = 0; id < 9; id++) {
    const horse = page.getByTestId(`horse-${id}`)
    while (!await horse.isVisible()) await page.getByTestId('pony-queue-down').click()
    await horse.click()
    const img = page.locator('.plaque-pony')
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    faces.push(await img.evaluate((el, box) => {
      const img = el as HTMLImageElement, rect = img.getBoundingClientRect(), plaque = img.closest('.player-plaque')!.getBoundingClientRect()
      const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
      return { width: (box[2] - box[0]) * img.naturalWidth * scale, height: (box[3] - box[1]) * img.naturalHeight * scale,
        x: rect.x - plaque.x + (rect.width - img.naturalWidth * scale) / 2 + (box[0] + box[2]) / 2 * img.naturalWidth * scale,
        y: rect.y - plaque.y + (rect.height - img.naturalHeight * scale) / 2 + (box[1] + box[3]) / 2 * img.naturalHeight * scale }
    }, PORTRAIT_FACES[id]))
  }
  const baseline = faces[0]!
  for (const [id, face] of faces.entries()) {
    expect(face.width / baseline.width, `pony ${id} face width`).toBeGreaterThan(id === 8 ? .70 : .85)
    expect(face.width / baseline.width, `pony ${id} face width`).toBeLessThan(1.15)
    expect(face.height / baseline.height, `pony ${id} face height`).toBeGreaterThan(id === 8 ? .60 : .80)
    expect(face.height / baseline.height, `pony ${id} face height`).toBeLessThan(1.20)
    const raised = [2, 5, 7].includes(id)
    expect(Math.abs(face.x - baseline.x + (raised ? 2 : 0)), `pony ${id} face horizontal focus`).toBeLessThan(8)
    expect(Math.abs(face.y - baseline.y + (raised ? 10 : 0)), `pony ${id} face vertical focus`).toBeLessThan(8)
    if (raised) {
      expect(face.x, `pony ${id} face horizontal focus stays inside`).toBeLessThan(baseline.x)
      expect(face.y, `pony ${id} face moved up`).toBeLessThan(baseline.y - 6)
    }
    if (id === 8) expect(face.width / baseline.width, 'Gugu face is smaller').toBeLessThan(.80)
  }
})

test('all nine plaques share a frame and paint their portrait underneath its front edge', async ({ page }, info) => {
  await page.goto('/tests/e2e/fixtures/pony-selection.html?reduced=1')
  const frames = new Set<string>()
  for (let id = 0; id < 9; id++) {
    const horse = page.getByTestId(`horse-${id}`)
    while (!await horse.isVisible()) await page.getByTestId('pony-queue-down').click()
    await horse.click()
    const plaque = page.locator('.player-plaque')
    await expect(plaque.locator('.plaque-pony')).toHaveAttribute('src', `/assets/art/ponies/${id}-${id === 1 || id >= 5 ? 'plaque-portrait' : 'portrait'}.webp`)
    const frame = plaque.locator('.plaque-frame')
    frames.add((await frame.getAttribute('src'))!)
    const layers = await plaque.evaluate(el => {
      const portrait = el.querySelector('.plaque-pony')!, frame = el.querySelector('.plaque-frame')!
      return { portrait: Number(getComputedStyle(portrait).zIndex), frame: Number(getComputedStyle(frame).zIndex), clip: getComputedStyle(frame).clipPath }
    })
    expect(layers.frame).toBeGreaterThan(layers.portrait)
    expect(layers.clip).not.toBe('none')
    await expect.poll(() => plaque.locator('img').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
    await plaque.screenshot({ path: info.outputPath(`plaque-${id}.png`) })
  }
  expect(frames.size).toBe(1)
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto('/tests/e2e/fixtures/pony-plaques.html')
  await expect.poll(() => page.locator('.plaque-pony').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.getByTestId('plaque-grid').screenshot({ path: info.outputPath('all-pony-plaques.png') })
})
