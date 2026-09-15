/**
 * 确定性向量测试。确定性由向量保证，不由代码审查保证。
 * 任一字段不等即阻断交付（不接受容差）。
 */
import { describe, expect, test } from 'bun:test'
import vectors from './terminal.json'
import {
  POLICY_IDLE,
  POLICY_MASH,
  POLICY_PERFECT,
  type SimPolicy,
} from '../core/sim.ts'
import { snapshot } from '../../../scripts/gen-vectors.ts'

const POLICIES: Record<string, SimPolicy> = {
  perfect: POLICY_PERFECT,
  idle: POLICY_IDLE,
  mash: POLICY_MASH,
  refresh: { ...POLICY_PERFECT, refreshes: 2, decide: 'last' },
  forfeit: { ...POLICY_PERFECT, decide: 'forfeit' },
}

describe('规则内核确定性向量', () => {
  test('向量非空，且 rulesVersion 一致', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(200)
    const versions = new Set(vectors.map((v) => v.rulesVersion))
    expect(versions.size).toBe(1)
  })

  test('全部向量逐字段完全相等', () => {
    for (const v of vectors) {
      const got = snapshot(v.seed, v.playerHorseId, v.stakeTier, v.policy, POLICIES[v.policy]!)
      expect(got).toEqual(v)
    }
  }, 300000)
})
