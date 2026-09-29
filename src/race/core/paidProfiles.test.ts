import { expect, test } from 'bun:test'
import { derivePaidProfiles, PLAYER_PAID_PROFILE } from './paidProfiles.ts'

const SEED = `0x${'11'.repeat(32)}` as const
const ANCHOR = `0x${'22'.repeat(32)}` as const

test('paid personalities have a frozen cross-language vector', () => {
  expect(derivePaidProfiles(SEED, ANCHOR, 2, 1)).toEqual([
    { base: 1212, acceleration: 14, cap: 1913 },
    PLAYER_PAID_PROFILE,
    { base: 1245, acceleration: 12, cap: 1853 },
    { base: 1237, acceleration: 11, cap: 1802 },
    { base: 1254, acceleration: 14, cap: 1786 },
  ])
})

test('new 0.5 MON tier has a fourth frozen personality range', () => {
  expect(derivePaidProfiles(SEED, ANCHOR, 4, 1)).toEqual([
    { base: 1332, acceleration: 16, cap: 2073 },
    PLAYER_PAID_PROFILE,
    { base: 1365, acceleration: 14, cap: 2013 },
    { base: 1357, acceleration: 13, cap: 1962 },
    { base: 1374, acceleration: 16, cap: 1946 },
  ])
})

test('selecting another horse does not change the four opponent personalities', () => {
  const opponents = (playerId: number) => derivePaidProfiles(SEED, ANCHOR, 2, playerId).filter((_, i) => i !== playerId)
  expect(opponents(0)).toEqual(opponents(4))
  expect(opponents(1)).toEqual(opponents(3))
})

test('paid profile input rejects free-demo tier and invalid horse', () => {
  expect(() => derivePaidProfiles(SEED, ANCHOR, 0 as 1, 1)).toThrow('INVALID_TIER')
  expect(() => derivePaidProfiles(SEED, ANCHOR, 1, 5)).toThrow('INVALID_HORSE')
})
