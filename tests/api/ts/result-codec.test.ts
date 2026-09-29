/**
 * L2 契约测试：RaceResult 的紧凑编码（src/chain/codec.ts）。scripts/race-sweep.ts 用它落盘与复算，
 * 编码必须与完整比赛记录逐字段往返相等，且长度留在 1KiB 以内。
 */
import { describe, expect, test } from 'bun:test'
import { MAX_RESULT_BYTES, decodeResult, encodeResult } from '../../../src/chain/codec.ts'
import { POLICY_MASH, POLICY_PERFECT, runRace } from '../../../src/race/core/sim.ts'
import { makeSeed } from '../../../src/race/core/rng.ts'

describe('RaceResult 编码解码往返相等', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => makeSeed(7000 + i))

  test('往返逐字段相等', () => {
    for (const seed of seeds) {
      for (const policy of [POLICY_PERFECT, POLICY_MASH]) {
        const { engine } = runRace({ seed, playerHorseId: 3, stakeTier: 2 }, policy)
        const r = engine.buildResult('race-' + seed.slice(2, 8))
        const round = decodeResult(encodeResult(r))
        expect(round).toEqual(r)
      }
    }
  }, 60000)

  test('编码长度低于 1KiB', () => {
    for (const seed of seeds.slice(0, 10)) {
      const { engine } = runRace({ seed, playerHorseId: 0, stakeTier: 3 }, POLICY_PERFECT)
      const enc = encodeResult(engine.buildResult('r'))
      expect(new TextEncoder().encode(enc).byteLength).toBeLessThan(MAX_RESULT_BYTES)
    }
  }, 30000)

  test('没有发生的事件用显式状态表达，不用缺省字段猜测', () => {
    const { engine } = runRace({ seed: seeds[0]!, playerHorseId: 0, stakeTier: 0 }, POLICY_PERFECT)
    const r = engine.buildResult('r')
    expect(r.choices.length).toBe(3)
    for (const c of r.choices) {
      expect(['picked', 'forfeited', 'timeout', 'not-reached']).toContain(c.reason)
      expect(Array.isArray(c.refreshes)).toBe(true)
    }
  })
})
