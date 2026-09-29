import { describe, expect, test } from 'bun:test'
import { ChainClock, startClockSync } from './chainClock.ts'

/** Deterministic LCG so every run sees the same poll phases and latencies. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A chain whose clock is local + TRUE_OFFSET, producing a block every intervalMs with floor-second stamps. */
function simChain(trueOffset: number, intervalMs: number, startLocal = 0) {
  const headAt = (local: number) => {
    const chainMs = local + trueOffset
    const produced = Math.floor((chainMs - (startLocal + trueOffset)) / intervalMs) * intervalMs + startLocal + trueOffset
    return Math.floor(produced / 1000)
  }
  return { headAt }
}

describe('chain clock', () => {
  const TRUE = 1_790_000_000_000 - 5_000

  test('head polls bracket the true chain time and converge well under a second', () => {
    const rand = lcg(7)
    const chain = simChain(TRUE, 350)
    const clock = new ChainClock({ headLagMs: 1000, epochOffsetMs: 0 })
    let local = 10_000
    for (let i = 0; i < 40; i++) {
      local += 400 + Math.floor(rand() * 900)
      const latency = 20 + Math.floor(rand() * 150)
      // the node answers with the head at the moment the request lands (half-way)
      const ts = chain.headAt(local + latency / 2)
      clock.observe({ timestampSec: ts, sentMs: local, receivedMs: local + latency, head: true })
      const est = clock.estimate(local + latency)
      const truth = local + latency + TRUE
      expect(est.synced).toBe(true)
      expect(est.lo).toBeLessThanOrEqual(truth)
      expect(est.hi).toBeGreaterThanOrEqual(truth)
    }
    const final = clock.estimate(local)
    expect(final.hi - final.lo).toBeLessThan(1400)
    expect(Math.abs(final.mid - (local + TRUE))).toBeLessThanOrEqual(final.errorMs)
  })

  test('a receipt only gives a lower bound; without a head sample hi assumes one second plus the head lag', () => {
    const clock = new ChainClock({ headLagMs: 500, epochOffsetMs: 0 })
    clock.observe({ timestampSec: 1000, sentMs: 0, receivedMs: 2_000, head: false })
    const est = clock.estimate(2_000)
    expect(est.lo).toBe(1_000_000)
    expect(est.hi).toBe(1_001_500)
    expect(est.errorMs).toBe(750)
  })

  test('the default local→Unix mapping is the page time origin', () => {
    const est = new ChainClock().estimate(0)
    expect(est.synced).toBe(false)
    expect(Math.abs(est.mid - performance.timeOrigin)).toBeLessThan(1)
  })

  test('falls back to the system clock with a wide assumed error before any sample', () => {
    const clock = new ChainClock({ epochOffsetMs: 1_000_000, fallbackErrorMs: 2000 })
    expect(clock.estimate(5)).toEqual({ lo: 998_005, mid: 1_000_005, hi: 1_002_005, errorMs: 2000, synced: false })
  })

  test('inconsistent samples (a local clock jump) drop the oldest until the rest agree', () => {
    const clock = new ChainClock({ headLagMs: 1000, epochOffsetMs: 0 })
    clock.observe({ timestampSec: 100, sentMs: 0, receivedMs: 10, head: true })
    // local clock jumped back by 60 s: the same chain second now looks 60 s later
    clock.observe({ timestampSec: 101, sentMs: -59_000, receivedMs: -58_990, head: true })
    const off = clock.offset()!
    expect(off.lo).toBe(101_000 + 58_990)
    expect(off.hi).toBe(101_000 + 2000 + 59_000)
  })

  test('samples age out of the window and junk samples are ignored', () => {
    const clock = new ChainClock({ windowMs: 1000, epochOffsetMs: 0 })
    clock.observe({ timestampSec: 10, sentMs: 0, receivedMs: 5, head: true })
    clock.observe({ timestampSec: Number.NaN, sentMs: 0, receivedMs: 5, head: true })
    clock.observe({ timestampSec: 10, sentMs: 9, receivedMs: 5, head: true })
    expect(clock.sampleCount).toBe(1)
    clock.observe({ timestampSec: 12, sentMs: 2000, receivedMs: 2010, head: true })
    expect(clock.sampleCount).toBe(1)
  })

  test('startClockSync feeds head samples on the injected time axis and stops cleanly', async () => {
    let t = 1000
    const clock = new ChainClock({ epochOffsetMs: 0 })
    const sync = startClockSync(
      { getBlock: async () => { t += 30; return { timestamp: 500n } } },
      clock,
      { intervalMs: 60_000, now: () => t },
    )
    await sync.sampleOnce()
    sync.stop()
    expect(clock.sampleCount).toBeGreaterThanOrEqual(1)
    const est = clock.estimate(t)
    expect(est.lo).toBeLessThanOrEqual(500_000 + 1000)
    expect(est.hi).toBeGreaterThanOrEqual(500_000)
  })
})
