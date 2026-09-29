import { expect, test } from 'bun:test'
import { paidSwap, paidSwapTriggerMs } from './paidSwap.ts'

const seed = `0x${'11'.repeat(32)}` as const
const anchor = `0x${'22'.repeat(32)}` as const
const horses = [0, 1, 2, 3, 4].map((laneIndex) => ({
  laneIndex, pos: BigInt(laneIndex * 10_000), dist: BigInt(laneIndex * 8_000), finished: false, immune: false,
}))

test('C-09 uses its original choice anchor and swaps position/lane without changing distance', () => {
  const result = paidSwap(horses, 1, seed, anchor, 1, 0n)
  expect(result.targetHorseId).toBe(3)
  expect(result.swapped).toBe(true)
  expect(result.horses[1]).toMatchObject({ laneIndex: 3, pos: 30_000n, dist: 8_000n })
  expect(result.horses[3]).toMatchObject({ laneIndex: 1, pos: 10_000n, dist: 24_000n })
})

test('a finished or immune target consumes the swap attempt without moving anyone', () => {
  const blocked = horses.map((horse, id) => id === 3 ? { ...horse, immune: true } : horse)
  const result = paidSwap(blocked, 1, seed, anchor, 1, 0n)
  expect(result.targetHorseId).toBe(3)
  expect(result.swapped).toBe(false)
  expect(result.horses).toEqual(blocked)
})

test('C-09 attempts immediately and every two simulation seconds, with expiry taking priority at 30 seconds', () => {
  expect(paidSwapTriggerMs(10_000n, 0)).toBe(10_000n)
  expect(paidSwapTriggerMs(10_000n, 14)).toBe(38_000n)
  expect(paidSwapTriggerMs(10_000n, 15)).toBeNull()
})
