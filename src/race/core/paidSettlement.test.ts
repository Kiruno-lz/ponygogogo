import { expect, test } from 'bun:test'
import { paidSettlement } from './paidSettlement.ts'

test('physical rank resolves equal millisecond finishes by horse ID', () => {
  expect(paidSettlement([12n, 12n, 11n, 13n, 12n], 4, [17, 19, 21])).toEqual({
    rawOrder: [2, 0, 1, 4, 3],
    settlementOrder: [4, 2, 0, 1, 3],
    rawRank: 4,
    settlementRank: 1,
    versionAnswer: true,
  })
})

test('version answer requires all three distinct components and preserves the other horses', () => {
  const times = [61n, 63n, 62n, 64n, 65n]
  expect(paidSettlement(times, 3, [18, 19, 21]).settlementOrder).toEqual([3, 0, 2, 1, 4])
  expect(paidSettlement(times, 3, [17, 19, 20]).settlementOrder).toEqual([0, 2, 1, 3, 4])
  expect(paidSettlement(times, 3, [17, 17, 21]).versionAnswer).toBe(false)
})
