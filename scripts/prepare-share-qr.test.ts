import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { transparentQr } from './prepare-share-qr.ts'

const shipped = PNG.sync.read(readFileSync(new URL('../public/assets/art/share/qr.png', import.meta.url)))
test('以 public 二维码为基线，去除白底后恢复原始模块和中间标识', () => {
  // Reconstruct a white-matte input from the shipped QR without reading the local artwork archive.
  const source = new PNG({ width: shipped.width, height: shipped.height })
  for (let i = 0; i < shipped.data.length; i += 4) {
    const alpha = shipped.data[i + 3] / 255
    for (let c = 0; c < 3; c++) source.data[i + c] = Math.round(shipped.data[i + c] * alpha + 255 * (1 - alpha))
    source.data[i + 3] = 255
  }
  const original = Buffer.from(source.data)
  const output = transparentQr(source)
  expect(output.data, '去白底必须完整恢复 public 中的二维码像素').toEqual(shipped.data)
  expect(output.width).toBe(source.width)
  expect(output.height).toBe(source.height)
  expect(output.data[3], 'outside white background must be transparent').toBe(0)
  let blackPixels = 0; let coloredPixels = 0; let removedWhite = 0
  for (let i = 0; i < original.length; i += 4) {
    const rgb = [original[i], original[i + 1], original[i + 2]]
    const min = Math.min(...rgb); const max = Math.max(...rgb)
    if (max === 0) {
      blackPixels++
      expect(output.data.subarray(i, i + 4)).toEqual(original.subarray(i, i + 4))
    }
    if (max - min > 1) {
      coloredPixels++
      expect(output.data.subarray(i, i + 4)).toEqual(original.subarray(i, i + 4))
    }
    if (min === 255 && output.data[i + 3] === 0) removedWhite++
    // Re-compositing onto white must recover the original QR within one channel value.
    const alpha = output.data[i + 3] / 255
    for (let c = 0; c < 3; c++) {
      const restored = Math.round(output.data[i + c] * alpha + 255 * (1 - alpha))
      if (Math.abs(restored - original[i + c]) > 1) throw new Error(`QR changed at channel ${i + c}`)
    }
  }
  expect(blackPixels).toBeGreaterThan(100_000)
  expect(coloredPixels).toBeGreaterThan(10_000)
  expect(removedWhite).toBeGreaterThan(400_000)
  expect(source.data, 'input stays untouched').toEqual(original)
  // The white horse's face inside the shield is foreground, not removable matte.
  const face = (Math.round(source.height * .5) * source.width + Math.round(source.width * .545)) * 4
  expect(output.data.subarray(face, face + 4)).toEqual(original.subarray(face, face + 4))
})
