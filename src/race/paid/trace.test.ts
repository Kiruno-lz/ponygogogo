import { expect, test } from 'bun:test'
import { motionDelta } from './motion.ts'
import { solvePaidCore } from './solver.ts'
import { fixtureInput, pickAt } from './testkit.ts'
import { bombsAt, sampleHorse, sampleStatus, tauAtWall, wallAtTau, windAt, type PaidTrace } from './trace.ts'

const busy = pickAt(pickAt(fixtureInput({
  playerDeck: [9, 22, 23, 11, 24, 25, 26, 20, 19, 1, 2, 6, 7, 8],
  cpu: { 0: [7, 6, 12], 2: [1, 13, 25], 3: [10, 24, 25], 4: [8, 16, 15] },
}), 1, 9), 2, 11)
const full = solvePaidCore(busy)
const trace = full.trace as PaidTrace

test('keyframes tile [0, tauEnd] per horse and dist is continuous across every boundary', () => {
  for (let h = 0; h < 5; h++) {
    const frames = trace.keyframes[h]!
    expect(frames[0]!.tau0).toBe(0n)
    for (let i = 0; i + 1 < frames.length; i++) {
      const f = frames[i]!
      const next = frames[i + 1]!
      if (f.finished) break
      expect(next.tau0).toBe(f.tau1)
      expect(next.dist).toBe(f.dist + motionDelta(f.motion, f.tau1 - f.tau0))
    }
    const last = frames.at(-1)!
    expect(last.finished).toBe(true)
    expect(last.tau0).toBe(full.finishTime[h])
  }
})

test('a partial solve ends in exactly the state the full trace samples at that ms', () => {
  for (const wall of [12_345n, 33_333n, 58_000n, 90_001n]) {
    const part = solvePaidCore(busy, { untilWall: wall })
    for (let h = 0; h < 5; h++) {
      const end = part.trace!.keyframes[h]!.at(-1)!
      const sample = sampleHorse(trace, h, part.tauEnd)
      expect([end.pos, end.dist, end.lane]).toEqual([sample.pos, sample.dist, sample.lane])
      expect(sampleHorse(part.trace!, h, part.tauEnd)).toEqual(sample)
    }
  }
})

test('status, bomb and wind samplers read the instance, bomb and wind tables', () => {
  const rocketOn = trace.instances.find((i) => i.cardId === 7)!.startTau
  expect(sampleStatus(trace, 0, rocketOn).equipment).toEqual({ torso: 7, tail: 0, hooves: 0 })
  expect(sampleStatus(trace, 4, trace.instances.find((i) => i.cardId === 8)!.startTau).equipment.tail).toBe(8)
  const bombTau = trace.bombs[0]!.placedTau
  expect(bombsAt(trace, bombTau - 1n)).toEqual([])
  expect(bombsAt(trace, bombTau).length).toBe(4)
  const windTau = trace.winds[0]!.tau
  expect(windAt(trace, windTau - 1n)).toBeNull()
  expect(windAt(trace, windTau)).toEqual(trace.winds[0]!)
  const done = sampleHorse(trace, 0, full.finishTime[0]! + 10_000n)
  expect(done).toMatchObject({ finished: true, v: 0n })
  expect(sampleHorse(trace, 1, 0n)).toMatchObject({ pos: 0n, dist: 0n, lane: 1, stamina: 1_000_000_000n })
  expect(trace.events).toBe(full.events)
  expect(trace.tauEnd).toBe(full.tauEnd)
})

test('time helpers agree with every logged event outside panel-close instants', () => {
  const closes = new Set(full.checkpoints.map((c) => c.closeTau))
  for (const e of full.events) {
    if (closes.has(e.tau)) continue
    expect(wallAtTau(trace, e.tau)).toBe(e.wall)
    expect(tauAtWall(trace, e.wall)).toBe(e.tau)
  }
})

test('trace can be disabled; samplers reject an empty trace', () => {
  expect(solvePaidCore(busy, { trace: false }).trace).toBeNull()
  expect(solvePaidCore(busy, { trace: false }).digest).toBe(full.digest)
  const empty: PaidTrace = { ...trace, keyframes: [[], [], [], [], []] }
  expect(() => sampleHorse(empty, 0, 0n)).toThrow('NO_TRACE')
})
