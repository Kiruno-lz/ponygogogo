import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('海报结束文字倾斜、金额和牌子一起下移且文字留在牌内', async ({ page }, testInfo) => {
  await page.goto('/')
  const render = await page.evaluate(async () => {
    const modulePath = '/src/export/poster.ts'
    const { drawPoster, posterContent } = await import(modulePath)
    const images: { src: string; angle: number; y: number }[] = []
    const texts: { text: string; font: string; width: number; y: number; right: number }[] = []
    const originalImage = CanvasRenderingContext2D.prototype.drawImage
    const originalText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.drawImage = function (...args: [CanvasImageSource, ...number[]]) {
      if (args[0] instanceof HTMLImageElement) {
        const matrix = this.getTransform()
        images.push({ src: new URL(args[0].src).pathname, angle: Math.atan2(matrix.b, matrix.a), y: matrix.f })
      }
      return originalImage.apply(this, args as Parameters<typeof originalImage>)
    }
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      const matrix = this.getTransform()
      const width = Math.min(this.measureText(text).width, maxWidth ?? Infinity)
      const right = matrix.transformPoint(new DOMPoint(x + width / 2, y)).x
      texts.push({ text, font: this.font, width, y: matrix.f, right })
      return originalText.call(this, text, x, y, maxWidth)
    }
    try {
      const result = { raceId: 'poster-composition', seed: '0x12', horseId: 1, rank: 2, finishTick: 100, endReason: 'finished', choices: [], gogoClicks: [] }
      const paid = { stakeLabel: '0.05', stake: 50_000_000_000_000_000n, previewRank: 2, phase: 'settled', settlement: { rank: 2, payout: 75_000_000_000_000_000n } }
      const content = posterContent(result, paid, 'en')
      const blob = await drawPoster(content)
      const png = await new Promise<string>(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.readAsDataURL(blob)
      })
      // Exercise the longest localized label and a long numeric value without truncation.
      await drawPoster({ ...content, amount: 'Awaiting chain verification' })
      await drawPoster({ ...content, amount: '+123456789.0123 MON' })
      return { images, texts, status: content.status, png }
    } finally {
      CanvasRenderingContext2D.prototype.drawImage = originalImage
      CanvasRenderingContext2D.prototype.fillText = originalText
    }
  })
  await writeFile(testInfo.outputPath('finish-poster.png'), Buffer.from(render.png, 'base64'))
  const finish = render.images.filter(image => image.src.endsWith('/finish.webp'))
  expect.soft(finish.length).toBe(3)
  for (const image of finish) expect.soft(image.angle, 'FINISH rises diagonally like WIN').toBeLessThan(-0.1)
  expect.soft(render.texts.some(text => text.text === render.status), 'no bottom-right status footer').toBe(false)
  const groups = render.images.filter(image => image.src.endsWith('/prize-group.webp'))
  expect.soft(groups.length, 'board and social captions are an independent layer').toBe(3)
  for (const image of groups) expect.soft(image.y, 'whole prize group moves down exactly 20px').toBe(20)
  for (const text of render.texts.filter(text => !text.text.startsWith('Great Run,') && text.text !== render.status)) {
    expect.soft(text.y, 'amount follows the board down 20px').toBe(555)
    expect.soft(Number(text.font.match(/([\d.]+)px/)![1]), 'smaller readable amount type').toBeLessThanOrEqual(42)
    expect.soft(text.width, 'fit full value inside the sign').toBeLessThanOrEqual(250.1)
    expect.soft(text.right, 'leave padding at the right wooden edge').toBeLessThanOrEqual(1376)
  }
  for (const text of render.texts.filter(text => text.text.startsWith('Great Run,'))) expect.soft(text.y).toBe(555)
})
