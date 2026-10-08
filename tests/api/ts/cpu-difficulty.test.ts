import { afterAll, describe, expect, test } from 'bun:test'
import { playRace, raceInput, unregisterNeutralRoles } from '../../../scripts/calibrate-cpu-difficulty.ts'
import { PLAYER_BALANCE } from '../../../src/race/paid/playerBalance.ts'

describe('CPU difficulty calibration inputs', () => {
  afterAll(() => {
    raceInput('test', 0, 0, 100, 500)
    unregisterNeutralRoles()
  })

  test('overrides the cap offset range in-process and restores production derivation', () => {
    const caps = (lo: number, hi: number) => raceInput('test', 3, 0, lo, hi).profiles.map(p => Number(p.cap))
    expect(caps(0, 0)).toEqual([1800, 1800, 1800, 1800, 1800])
    const random = caps(100, 500)
    expect(random[3]).toBe(1800)
    for (const [h, cap] of random.entries()) if (h !== 3) expect(cap).toBeGreaterThanOrEqual(1900), expect(cap).toBeLessThanOrEqual(2300)
    expect(PLAYER_BALANCE.cpuCapOffsetMin).toBe(100)
    expect(PLAYER_BALANCE.cpuCapOffsetMax).toBe(500)
  })

  test('random play is deterministic and every stored choice takes effect', () => {
    const core = raceInput('test', 1, 3, 100, 500)
    const [a, b] = [playRace(core, 'random'), playRace(core, 'random')]
    expect(a.digest).toBe(b.digest)
    expect(a.checkpoints.every(c => c.invalidReason === 0)).toBe(true)
    expect(a.roster![core.playerHorseId]).toBe(3)
  })
})
