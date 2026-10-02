import { describe, expect, test } from 'bun:test'
import { HORSE_FOOTINGS, POSTER, horseTransform, platformUrl, posterContent } from './poster.ts'
import type { RaceResult } from '../race/core/types.ts'
import type { PaidResultView } from '../result/ResultScreen.tsx'

const result: RaceResult = { raceId: 'share', seed: '0x12', horseId: 2, rank: 1, finishTick: 100, choices: [], gogoClicks: [], endReason: 'finished' }
const paid: PaidResultView = { stakeLabel: '0.05', stake: 50_000_000_000_000_000n, previewRank: 1, phase: 'settled', txHash: null, detail: null, settlement: { rank: 3, payout: 25_000_000_000_000_000n }, mismatch: true, deadline: null, choiceNotes: [], onRetry() {} }

describe('海报只表达真实比赛和结算结果', () => {
  test('试玩不能生成虚构收益', () => {
    const content = posterContent(result, undefined, 'en')
    expect(content.rank).toBe(1)
    expect(content.horseId).toBe(2)
    expect(content.amount).toBe('Free practice')
    expect(content.status).toBe('No prize')
  })
  test('链上名次覆盖预览，显示净亏损而非虚构 +10 MON', () => {
    const content = posterContent(result, paid, 'en')
    expect(content.rank).toBe(3)
    expect(content.amount).toBe('-0.025 MON')
    expect(content.status).toContain('Settled')
    expect(content.headline).not.toBe('WIN')
  })
  test.each(['waiting', 'pending', 'failed'] as const)('%s 不把预估金额当成到账', phase => {
    const content = posterContent(result, { ...paid, phase, settlement: null }, 'en')
    expect(content.amount).toBe('Awaiting chain')
    expect(content.status).toContain('Preview rank 1')
    expect(content.status).toContain(phase === 'failed' ? 'Failed' : 'Settling')
  })
  test('判负返还为零、净盈亏等于负下注', () => {
    const content = posterContent(result, { ...paid, phase: 'forfeited', settlement: null }, 'en')
    expect(content.amount).toBe('-0.05 MON')
    expect(content.status).toContain('Forfeited')
    expect(content.headline).not.toBe('WIN')
  })
  test('确认盈利后才显示盈利额', () => {
    const content = posterContent(result, { ...paid, settlement: { rank: 1, payout: 550_000_000_000_000_000n } }, 'en')
    expect(content.amount).toBe('+0.5 MON')
    expect(content.headline).toBe('WIN')
  })
})

test('平台跳转链接正确编码海报结果', () => {
  const url = new URL(platformUrl('x', 'Ponygogogo #3 · -0.025 MON'))
  expect(url.origin + url.pathname).toBe('https://x.com/intent/post')
  expect(url.searchParams.get('text')).toBe('Ponygogogo #3 · -0.025 MON')
  expect(platformUrl('instagram', '')).toBe('https://www.instagram.com/')
  expect(platformUrl('xiaohongshu', '')).toBe('https://www.xiaohongshu.com/')
})

test('所有主角的前后蹄底都注册到奖台顶面的透视，二维码顺着木牌倾斜', () => {
  for (let horse = 0; horse < 5; horse++) {
    const [a, b, c, d, x, y] = horseTransform(horse)
    const { rear, front } = HORSE_FOOTINGS[horse]
    for (const [point, expected] of [[rear, [330, 545]], [front, [680, 576]]] as const) {
      expect(a * point[0] + c * point[1] + x).toBeCloseTo(expected[0], 8)
      expect(b * point[0] + d * point[1] + y).toBeCloseTo(expected[1], 8)
    }
  }
  expect(POSTER.qr.angle).toBeGreaterThan(-0.06)
  expect(POSTER.qr.angle).toBeLessThan(-0.02)
})
