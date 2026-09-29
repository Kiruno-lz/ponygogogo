import { describe, expect, test } from 'bun:test'
import { keccak256, toHex, type Hex } from 'viem'
import {
  ANCHOR_HISTORY_BLOCKS, DEFAULT_BLOCK_MS, deadlineMinutes, earliestUnsealedAnchor, measuredBlockMs, settleDeadline,
  type AnchorView,
} from './settleDeadline.ts'

const ZERO = `0x${'00'.repeat(32)}` as Hex
const SEALED = keccak256(toHex('sealed'))
const none = { present: false, blockNumber: 0n, anchor: ZERO }

function view(openAnchor: Hex, choices: AnchorView['choices'] = [none, none, none]): AnchorView {
  return { openedAt: 1_790_000_000n, openedBlock: 1_000n, openAnchor, choices }
}

describe('settlement deadline', () => {
  test('the earliest unsealed required anchor decides; sealed anchors and absent choices do not count', () => {
    expect(earliestUnsealedAnchor(view(ZERO))).toBe(1_000n)
    const later = view(SEALED, [{ present: true, blockNumber: 1_200n, anchor: SEALED }, { present: true, blockNumber: 1_500n, anchor: ZERO }, none])
    expect(earliestUnsealedAnchor(later)).toBe(1_500n)
    expect(earliestUnsealedAnchor(view(SEALED, [{ present: true, blockNumber: 1_200n, anchor: SEALED }, none, none]))).toBeNull()
    expect(settleDeadline(view(SEALED), { number: 99_999n, timestamp: 0n })).toEqual({ state: 'sealed' })
  })

  test('blocks left = anchor + 8191 − head, at the measured block time capped by the default', () => {
    // 400 blocks in 160 s = 400 ms/block, slower than the default: the default (earlier deadline) wins
    const slow = settleDeadline(view(ZERO), { number: 1_400n, timestamp: 1_790_000_160n })
    expect(slow).toEqual({
      state: 'open', anchorBlock: 1_000n, blocksLeft: ANCHOR_HISTORY_BLOCKS - 400n, blockMs: DEFAULT_BLOCK_MS,
      msLeft: Math.floor(Number(ANCHOR_HISTORY_BLOCKS - 400n) * DEFAULT_BLOCK_MS),
    })
    // 400 blocks in 100 s = 250 ms/block: faster than the default, so the measurement is used
    expect(measuredBlockMs(view(ZERO), { number: 1_400n, timestamp: 1_790_000_100n })).toBe(250)
    // too few blocks, or a non-increasing clock (anvil warps), fall back to the default
    expect(measuredBlockMs(view(ZERO), { number: 1_010n, timestamp: 1_790_000_001n })).toBe(DEFAULT_BLOCK_MS)
    expect(measuredBlockMs(view(ZERO), { number: 1_400n, timestamp: 1_790_000_000n })).toBe(DEFAULT_BLOCK_MS)
  })

  test('the anchor is lost once only the current head is left inside the window', () => {
    const last = 1_000n + ANCHOR_HISTORY_BLOCKS
    expect(settleDeadline(view(ZERO), { number: last - 1n, timestamp: 1_790_002_000n })).toMatchObject({ state: 'open', blocksLeft: 1n })
    expect(settleDeadline(view(ZERO), { number: last, timestamp: 1_790_002_000n })).toEqual({ state: 'lost', anchorBlock: 1_000n })
    expect(settleDeadline(view(ZERO), { number: last + 50n, timestamp: 1_790_002_000n }).state).toBe('lost')
  })

  test('minutes are rounded down, never negative', () => {
    expect(deadlineMinutes(Number(ANCHOR_HISTORY_BLOCKS) * DEFAULT_BLOCK_MS)).toBe(46)
    expect(deadlineMinutes(59_999)).toBe(0)
    expect(deadlineMinutes(-5)).toBe(0)
  })
})
