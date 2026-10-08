import { expect, test } from 'bun:test'
import { derivePaidProfiles } from '../core/paidProfiles.ts'
import { FP } from '../core/fixed.ts'
import { idlePaidState } from '../paidSnapshot.ts'
import { EV_EXHAUST_ENTER, EV_EXHAUST_EXIT, EV_OVERCAP_END } from './events.ts'
import { motionDelta, speedAt } from './motion.ts'
import { solvePaidCore } from './solver.ts'
import { FIXTURE_ANCHOR, FIXTURE_SEED, fixtureInput, newCardInput, pickAt } from './testkit.ts'
import { sampleHorse } from './trace.ts'

const roster = [0, 2, 3, 4, 5]
function currentInput() {
  const profiles = derivePaidProfiles(FIXTURE_SEED, FIXTURE_ANCHOR, 2, 0)
    .map(p => ({ base: BigInt(p.base), acceleration: BigInt(p.acceleration), cap: BigInt(p.cap) }))
  return fixtureInput({ roster, playerHorseId: 0, profiles })
}

test('player starts at 300, accelerates at 150 and caps at 1800; opponents share the start and stamina model', () => {
  const profiles = derivePaidProfiles(FIXTURE_SEED, FIXTURE_ANCHOR, 2, 1)
  expect(profiles[1]).toEqual({ base: 300, acceleration: 150, cap: 1800 })
  expect(profiles.map(p => [p.base, p.acceleration])).toEqual(Array.from({ length: 5 }, () => [300, 150]))
  const result = solvePaidCore(currentInput()), trace = result.trace!
  expect(sampleHorse(trace, 0, 0n)).toMatchObject({ b: 300_000n, v: 300_000n, stamina: 300_000_000n })
  expect(sampleHorse(trace, 0, 10_000n)).toMatchObject({ b: 1_800_000n, v: 1_800_000n, dist: 10_500_000_000n, stamina: 200_000_000n })
  expect(result.checkpoints[0].openTau).toBe(18_056n)
  expect(sampleHorse(trace, 0, 18_056n).stamina).toBe(119_440_000n)
  for (let h = 1; h < 5; h++) {
    const stamina = trace.keyframes[h][0].stamina
    expect(stamina).toMatchObject({ s: 300_000_000n, capacity: 300_000_000n, exhaustRelease: 135_000_000n, overcapCostDivisor: 2n })
    expect(stamina.cost).toBe(h === 4 ? 22_000n : 20_000n)
    expect(stamina.regen).toBe(10_000n)
  }
})

test('player exhaustion clamps base speed to 1200 and release resumes acceleration without restoring speed', () => {
  const result = solvePaidCore(currentInput()), trace = result.trace!
  expect(result.events.find(e => e.horse === 0 && e.code === EV_EXHAUST_ENTER)?.tau).toBe(30_000n)
  expect(result.events.find(e => e.horse === 0 && e.code === EV_EXHAUST_EXIT)?.tau).toBe(39_000n)
  expect(sampleHorse(trace, 0, 30_000n)).toMatchObject({ b: 1_200_000n, v: 1_200_000n, exhausted: true })
  expect(sampleHorse(trace, 0, 38_999n)).toMatchObject({ b: 1_200_000n, v: 1_200_000n, stamina: 134_985_000n, exhausted: true })
  expect(sampleHorse(trace, 0, 39_000n)).toMatchObject({ b: 1_200_000n, v: 1_200_000n, stamina: 135_000_000n, exhausted: false })
  const distance = sampleHorse(trace, 0, 39_000n).dist - sampleHorse(trace, 0, 30_000n).dist
  expect(distance).toBe(10_800_000_000n)
  expect(sampleHorse(trace, 0, 42_999n).b).toBe(1_799_850n)
  expect(sampleHorse(trace, 0, 43_000n).b).toBe(1_800_000n)
  const total = sampleHorse(trace, 0, 43_000n).dist - sampleHorse(trace, 0, 30_000n).dist
  expect(total).toBe(16_800_000_000n)
  expect(1_800_000n * 13_000n - total).toBe(6_600_000_000n)
})

test('exhaustion preserves base speed below 1200 and applies percentage and fixed effects after the base cap', () => {
  const slowInput = currentInput()
  slowInput.profiles = slowInput.profiles.map((p, h) => h === 0 ? { ...p, acceleration: 0n } : p)
  expect(sampleHorse(solvePaidCore(slowInput).trace!, 0, 30_000n)).toMatchObject({ b: 300_000n, v: 300_000n })
  const light = currentInput()
  light.roster = [1, 0, 2, 3, 4]
  expect(sampleHorse(solvePaidCore(light).trace!, 0, 30_000n)).toMatchObject({ b: 1_200_000n, v: 1_200_000n })
  let fixed = newCardInput([17], { roster, playerHorseId: 0, profiles: currentInput().profiles })
  fixed = pickAt(fixed, 1, 17)
  expect(sampleHorse(solvePaidCore(fixed).trace!, 0, 30_000n)).toMatchObject({ b: 1_300_000n, v: 1_300_000n })
})

test('player adrenaline overcap drains at half the running cost and does not regenerate', () => {
  let input = newCardInput([15], { roster, playerHorseId: 0, profiles: currentInput().profiles })
  input = pickAt(input, 1, 15)
  const result = solvePaidCore(input), trace = result.trace!
  const card = trace.cards.find(c => c.horse === 0 && c.cardId === 15)!
  const before = 300_000_000n - card.tau * 10_000n
  const after = before + 250_000_000n
  expect(after).toBeGreaterThan(300_000_000n)
  expect(sampleHorse(trace, 0, card.tau + 1_000n).stamina).toBe(after - 10_000_000n)
  const end = result.events.find(e => e.horse === 0 && e.code === EV_OVERCAP_END)!
  expect(end.tau - card.tau).toBe((after - 300_000_000n + 9_999n) / 10_000n)
})

test('full-speed death recovery from zero at 150 takes 12 seconds and loses 10800 distance', () => {
  const result = solvePaidCore(currentInput())
  const acceleration = result.trace!.keyframes[0][0].motion.aEff
  const recovery = { exhausted: false, b: 0n, aEff: acceleration, mult: 10_000n, fixed: 0n }
  expect(acceleration).toBe(150n)
  expect(speedAt(recovery, 1_800_000n, 12_000n)).toBe(1_800_000n)
  expect(1_800_000n * 12_000n - motionDelta(recovery, 12_000n)).toBe(10_800_000_000n)
})

test('roster countdown stamina is 300 for every horse; records without a roster keep 1000', () => {
  expect(idlePaidState(0, 0, roster).horses.map(h => h.stamina / FP)).toEqual([300, 300, 300, 300, 300])
  expect(idlePaidState(0, 0).horses.map(h => h.stamina / FP)).toEqual([1000, 1000, 1000, 1000, 1000])
})
