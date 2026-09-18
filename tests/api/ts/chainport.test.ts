/**
 * L2 契约测试：一局比赛的进出账。**这份测试是给将来的真实实现准备的**——
 * 合约接上时，同一份测试必须原样通过。
 * 账户身份不在这个端口里，那部分契约在 wallet.test.ts。
 */
import { describe, expect, test } from 'bun:test'
import { MockChainPort } from '../../../src/chain/mock.ts'
import { MON, formatMon, type ChainPort } from '../../../src/chain/port.ts'
import { MAX_RESULT_BYTES, decodeResult, encodeResult } from '../../../src/chain/codec.ts'
import { POLICY_MASH, POLICY_PERFECT, runRace } from '../../../src/race/core/sim.ts'
import { makeSeed } from '../../../src/race/core/rng.ts'
import type { RaceResult } from '../../../src/race/core/types.ts'

function makePort(): ChainPort {
  return new MockChainPort()
}

describe('ChainPort 契约', () => {
  test('游戏余额从 10 MON 起算', async () => {
    const port = makePort()
    expect(await port.getBalance()).toBe(10n * MON)
    expect(formatMon(10n * MON)).toBe('10.00')
  })

  test('enterRace 扣除下注、返回 seed 与 raceId；raceId 不重复', async () => {
    const port = makePort()
    const a = await port.enterRace(1n * MON)
    const b = await port.enterRace(0n)
    expect(a.seed).toMatch(/^0x[0-9a-f]+$/)
    expect(a.raceId).not.toBe(b.raceId)
    expect(await port.getBalance()).toBe(9n * MON)
  })

  test('0 下注走同一条流程，余额不变', async () => {
    const port = makePort()
    const before = await port.getBalance()
    const r = await port.enterRace(0n)
    expect(r.seed.length).toBeGreaterThan(10)
    expect(await port.getBalance()).toBe(before)
  })

  test('余额不足时 enterRace 抛错，且不扣款', async () => {
    const port = makePort()
    await expect(port.enterRace(999n * MON)).rejects.toThrow()
    expect(await port.getBalance()).toBe(10n * MON)
  })

  test('settleRace 返回本地回执，且不是交易哈希形态', async () => {
    const port = makePort()
    const { raceId, seed } = await port.enterRace(0n)
    const { engine } = runRace({ seed, playerHorseId: 0, stakeTier: 0 }, POLICY_PERFECT)
    const { receiptId } = await port.settleRace(engine.buildResult(raceId))
    expect(receiptId.startsWith('0x')).toBe(false)
    expect(receiptId).toMatch(/^receipt-[0-9a-f]+$/)
  })

  test('只保存最近一场战绩', async () => {
    const port = makePort()
    const mk = async (): Promise<RaceResult> => {
      const { raceId, seed } = await port.enterRace(0n)
      return runRace({ seed, playerHorseId: 1, stakeTier: 0 }, POLICY_MASH).engine.buildResult(raceId)
    }
    const r1 = await mk()
    await port.settleRace(r1)
    const r2 = await mk()
    await port.settleRace(r2)
    const last = port.lastResult()
    expect(last?.raceId).toBe(r2.raceId)
  })
})

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
