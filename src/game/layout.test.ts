import { describe, expect, test } from 'bun:test'
import { DESIGN_W, DESIGN_H, TRACK_TOP, TRACK_BOTTOM, PLAYER_ANCHOR_X, laneGroundY } from './layout.ts'

describe('reference artwork registration', () => {
  test('uses the complete 1619 × 971 reference canvas without vertical distortion', () => {
    expect([DESIGN_W, DESIGN_H]).toEqual([1619, 971])
  })
  test('registers all five horse baselines to the reference lane dividers', () => {
    expect([TRACK_TOP, TRACK_BOTTOM]).toEqual([356, 769])
    expect(laneGroundY(4)).toBeCloseTo(428, 0)
    expect(laneGroundY(0)).toBeCloseTo(758, 0)
    expect(Array.from({ length: 5 }, (_, lane) => laneGroundY(lane))).toEqual([758, 669, 588, 502, 428])
  })
  test('keeps the player ring at the reference race camera anchor', () => {
    expect(PLAYER_ANCHOR_X * DESIGN_W).toBeCloseTo(862, 0)
  })
})
