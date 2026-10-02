/**
 * L2 契约测试：RaceResult 的紧凑编码（src/chain/codec.ts）。
 * 比赛记录取自共享求时器的免费试玩驱动器；编码必须与完整比赛记录逐字段往返相等，且长度留在 1KiB 以内。
 */
import { describe, expect, test } from 'bun:test'
import { MAX_RESULT_BYTES, decodeResult, encodeResult } from '../../../src/chain/codec.ts'
import { RaceDriver } from '../../../src/race/driver.ts'
import { makeSeed } from '../../../src/race/core/rng.ts'

function resultOf(seed: string, playerHorseId: number, raceId: string) {
  return new RaceDriver({ seed, playerHorseId, stakeTier: 0 }).buildResult(raceId)
}

describe('RaceResult 编码解码往返相等', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => makeSeed(7000 + i))

  test('往返逐字段相等', () => {
    for (const seed of seeds) {
      for (const playerHorseId of [0, 3]) {
        const r = resultOf(seed, playerHorseId, 'race-' + seed.slice(2, 8))
        const round = decodeResult(encodeResult(r))
        expect(round).toEqual(r)
      }
    }
  }, 60000)

  test('编码长度低于 1KiB', () => {
    for (const seed of seeds.slice(0, 10)) {
      const enc = encodeResult(resultOf(seed, 0, 'r'))
      expect(new TextEncoder().encode(enc).byteLength).toBeLessThan(MAX_RESULT_BYTES)
    }
  }, 30000)

  test('没有发生的事件用显式状态表达，不用缺省字段猜测', () => {
    const r = resultOf(seeds[0]!, 0, 'r')
    expect(r.choices.length).toBe(3)
    for (const c of r.choices) {
      expect(['picked', 'forfeited', 'timeout', 'not-reached']).toContain(c.reason)
      expect(Array.isArray(c.refreshes)).toBe(true)
    }
  })
})
