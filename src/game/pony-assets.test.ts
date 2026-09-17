import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HORSE_PROFILES } from './horses.ts'

const folder = new URL('../../public/assets/art/ponies/', import.meta.url)
function header(file: string) {
  const bytes = readFileSync(new URL(file, folder))
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20), color: bytes[25], bytes }
}

describe('production pony PNG artwork', () => {
  for (const horse of HORSE_PROFILES) for (const action of ['running', 'idle']) {
    test(`${horse.name} ${action}: eight complete transparent frames usable by both renderers`, () => {
      const sheet = header(`${horse.horseId}-${action}.png`)
      expect([sheet.w, sheet.h, sheet.color]).toEqual([2048, 192, 6])
      const unique = new Set<string>()
      for (let frame = 0; frame < 8; frame++) {
        const single = header(`${horse.horseId}-${action}-${frame}.png`)
        expect([single.w, single.h, single.color]).toEqual([256, 192, 6])
        unique.add(single.bytes.toString('base64'))
      }
      expect(unique.size).toBe(8)
      const animated = header(`${horse.horseId}-${action}-animated.png`)
      const control = animated.bytes.indexOf(Buffer.from('acTL'))
      expect(control).toBeGreaterThan(0)
      expect(animated.bytes.readUInt32BE(control + 4)).toBe(8)
    })
  }
})
