import { expect, test } from 'bun:test'
import { chainEntropy, PURPOSE_CARD } from './chainEntropy.ts'

test('chain entropy is bound to seed, canonical block hash, checkpoint, purpose and event index', () => {
  const seed = `0x${'11'.repeat(32)}` as const
  const hash = `0x${'22'.repeat(32)}` as const
  const first = chainEntropy(seed, hash, 1, PURPOSE_CARD, 0n)
  expect(first).toBe(51778732510541152314612458493674837176660517930126499501476568726664666962423n)
  expect(chainEntropy(seed, hash, 1, PURPOSE_CARD, 1n)).not.toBe(first)
  expect(chainEntropy(seed, `0x${'23'.repeat(32)}`, 1, PURPOSE_CARD, 0n)).not.toBe(first)
})
