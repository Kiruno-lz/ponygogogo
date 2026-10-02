import { expect, test } from 'bun:test'
import type { RaceResult } from '../race/core/types.ts'
import { drawPoster } from './poster.ts'

test('the actual poster renderer gives new rare cards gold borders and loads their SVGs', async () => {
  const borders: string[] = [], images: string[] = []
  const noop = () => {}
  const ctx = {
    strokeStyle: '', fillStyle: '', lineWidth: 0, font: '', textBaseline: '', textAlign: '',
    createLinearGradient: () => ({ addColorStop: noop }), fillRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, arcTo: noop, closePath: noop,
    fill: noop, stroke: () => borders.push(ctx.strokeStyle), fillText: noop, drawImage: noop,
  }
  const previous = ['document', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => ctx, toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'])) }),
  } })
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    onload: (() => void) | null = null
    set src(url: string) { images.push(url); queueMicrotask(() => this.onload?.()) }
  } })
  const result: RaceResult = {
    raceId: 'poster-cards', seed: 'cards', horseId: 0, rank: 1, finishTick: 1000, gogoClicks: [], endReason: 'finished',
    choices: [22, 23, 40].map((id, i) => ({ checkpoint: i as 0 | 1 | 2, cardId: `C-${id}`, reason: 'picked', refreshes: [] })),
  }
  try {
    await drawPoster(result, 1, 'zh', 'x')
    expect(borders.slice(-3)).toEqual(['#f4a22a', '#a3714c', '#f4a22a'])
    expect(images.filter(url => url.includes('/cards/'))).toEqual([
      '/assets/cards/card-22.svg', '/assets/cards/card-23.svg', '/assets/cards/card-40.svg',
    ])
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
