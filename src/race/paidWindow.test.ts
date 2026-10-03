import { describe, expect, test } from 'bun:test'
import { applyPaidChoice, initialPaidDrawState } from './core/paidDrawRules.ts'
import {
  acceptCutoffWall, acceptsClick, ALCHEMY_TIMING, DEV_EOA_TIMING, LatencyEstimator, maySend, predictTxSec,
  refreshPreview, settleReadyWall, windowEndWall,
} from './paidWindow.ts'

const range = (mid: number, err = 0) => ({ lo: mid - err, mid, hi: mid + err })

describe('choice window and margin', () => {
  test('a choice is sent only once the lower bound has passed openSec', () => {
    expect(maySend(20, range(19_999))).toBe(false)
    expect(maySend(20, range(20_000))).toBe(true)
    // mid past openSec but the clock is unsure by 300 ms: wait
    expect(maySend(20, range(20_200, 300))).toBe(false)
    expect(maySend(20, range(20_300, 300))).toBe(true)
  })

  test('clicks stop at openSec + 20 − margin judged by the upper bound', () => {
    expect(windowEndWall(20)).toBe(40_000)
    expect(acceptCutoffWall(20, ALCHEMY_TIMING.marginMs)).toBe(35_000)
    expect(acceptsClick(20, range(34_999), ALCHEMY_TIMING.marginMs)).toBe(true)
    expect(acceptsClick(20, range(35_000), ALCHEMY_TIMING.marginMs)).toBe(false)
    expect(acceptsClick(20, range(34_600, 500), ALCHEMY_TIMING.marginMs)).toBe(false)
    expect(acceptsClick(20, range(37_999), DEV_EOA_TIMING.marginMs)).toBe(true)
    expect(acceptsClick(20, range(38_000), DEV_EOA_TIMING.marginMs)).toBe(false)
  })

  test('margins leave room for the measured inclusion latency', () => {
    // Alchemy on Monad testnet: p50 1540 ms, p95 1902 ms submit→inclusion; the prediction sits just above p50 and the
    // last accepted click must still land before the window end even at p95
    expect(ALCHEMY_TIMING.latencyMs).toBe(1600)
    expect(ALCHEMY_TIMING.marginMs).toBeGreaterThan(1902)
    expect(DEV_EOA_TIMING.marginMs).toBeGreaterThan(DEV_EOA_TIMING.latencyMs)
  })

  test('predicted txSec is floor((send + latency)/1000) clamped into [openSec, openSec + 19]', () => {
    expect(predictTxSec(20, 20_100, 2900)).toBe(23)
    expect(predictTxSec(20, 20_000, 700)).toBe(20)
    expect(predictTxSec(20, 18_000, 700)).toBe(20)
    expect(predictTxSec(20, 38_500, 2900)).toBe(39)
  })

  test('settlement waits for the whole second after finishWall plus a margin', () => {
    expect(settleReadyWall(61_234)).toBe(62_300)
    expect(settleReadyWall(62_000)).toBe(62_300)
  })

  test('latency estimate starts at the default and follows the median of clamped samples', () => {
    const est = new LatencyEstimator(2900, 3)
    expect(est.value).toBe(2900)
    est.sample(1000)
    est.sample(99_999)
    est.sample(-5)
    expect(est.value).toBe(1000)
    est.sample(2000)
    expect(est.value).toBe(2000)
    est.sample(Number.NaN)
    expect(est.value).toBe(2000)
  })
})

describe('refresh preview', () => {
  const deck = [17, 18, 21, 14, 19, 15, 20, 1, 2, 6, 7, 8, 10, 12]

  test('matches applyPaidChoice: each refresh takes deck[--tailCursor] into that slot', () => {
    const draw = { ...initialPaidDrawState(), refreshCredits: 2 }
    const none = refreshPreview(deck, draw, [])
    expect(none.candidates).toEqual([17, 18, 21])
    expect(none.creditsLeft).toBe(2)
    expect(none.canRefresh).toEqual([true, true, true])
    const two = refreshPreview(deck, draw, [2, 0])
    expect(two.candidates).toEqual([10, 18, 12])
    expect(two.creditsLeft).toBe(0)
    expect(two.canRefresh).toEqual([false, false, false])
    // the rule engine accepts exactly this offer and rejects a card that was refreshed away
    expect(() => applyPaidChoice(deck, draw, [2, 0], 10)).not.toThrow()
    expect(() => applyPaidChoice(deck, draw, [2, 0], 17)).toThrow('CARD_NOT_OFFERED')
  })

  test('a slot refreshes once per checkpoint; no credits, auto or cut disables refresh', () => {
    const draw = { ...initialPaidDrawState(), refreshCredits: 3 }
    expect(refreshPreview(deck, draw, [1]).canRefresh).toEqual([true, false, true])
    expect(() => refreshPreview(deck, draw, [1, 1])).toThrow('INVALID_REFRESH')
    expect(() => refreshPreview(deck, initialPaidDrawState(), [0])).toThrow('NO_REFRESH_CREDIT')
    expect(refreshPreview(deck, { ...draw, automatic: true }, []).canRefresh).toEqual([false, false, false])
    expect(refreshPreview(deck, { ...draw, forfeited: true }, []).canRefresh).toEqual([false, false, false])
  })

  test('the reverse cursor may not run into the forward cursor', () => {
    const draw = { ...initialPaidDrawState(), cursor: 9, tailCursor: 13, refreshCredits: 3 }
    const view = refreshPreview(deck, draw, [0])
    expect(view.candidates[0]).toBe(10)
    expect(view.canRefresh).toEqual([false, false, false])
    expect(() => refreshPreview(deck, draw, [0, 1])).toThrow('NO_REFRESH_CREDIT')
  })
})
