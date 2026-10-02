import { expect, test } from 'bun:test'
import { keccak256, padHex, toBytes, type Hex } from 'viem'
import { RaceDriver } from './driver.ts'
import { solvePaidRace } from './paid/race.ts'
import { sampleHorse, tauAtWall } from './paid/trace.ts'
import { demoPos, demoSpeed, demoStamina, paidCardKey } from './paidSnapshot.ts'
import { derivePaidDeck } from './core/paidDeck.ts'
import { solvePaidCore } from './paid/solver.ts'
import { paidRaceResult } from './paidResult.ts'

const seed = padHex('0x12345678', { size: 32 }) as Hex
const anchor = keccak256(toBytes(`practice.open:${seed}`))
const cfg = { seed, playerHorseId: 2, stakeTier: 0 }
const opts = { countdownMs: 0, tailSpeed: 6 }
function advance(d: RaceDriver, until: number, clicking = false) {
  d.update(0)
  for (let t = 20; t <= until; t += 20) {
    if (clicking && t % 200 === 0) d.input({ kind: 'gogoDown' })
    d.update(t)
  }
}

test('免费试玩的五马速度、位置、体力与最低下注档同一求时器一致', () => {
  const d = new RaceDriver(cfg, opts)
  advance(d, 10_000)
  const expected = solvePaidRace({ seed, openAnchor: anchor, playerHorseId: 2, stakeTier: 1, choices: [null, null, null] })
  const tau = tauAtWall(expected.trace!, 10_000n)
  for (let h = 0; h < 5; h++) {
    const s = sampleHorse(expected.trace!, h, tau)
    expect(d.state.horses[h].pos).toBe(demoPos(s.pos))
    expect(d.state.horses[h].v).toBe(demoSpeed(s.v))
    expect(d.state.horses[h].stamina).toBe(demoStamina(s.stamina))
  }
})

test('gogo 改变反馈，不改变免费试玩任意马的速度、体力、位置或名次', () => {
  const idle = new RaceDriver(cfg, opts), clicked = new RaceDriver(cfg, opts)
  advance(idle, 10_000)
  advance(clicked, 10_000, true)
  expect(clicked.state.horses).toEqual(idle.state.horses)
  expect(clicked.replayInput).toEqual(idle.replayInput)
  expect(clicked.canonicalResult()).toEqual(idle.canonicalResult())
  expect(clicked.buildResult('gogo-test')).toEqual(idle.buildResult('gogo-test'))
})


function offering(card: number) {
  for (let i = 0; i < 400; i++) {
    const seed = keccak256(toBytes(`practice-card-${i}`))
    const anchor = keccak256(toBytes(`practice.open:${seed}`))
    if (derivePaidDeck(seed, anchor).slice(0, 3).includes(card)) return seed
  }
  throw new Error(`no opening offer for ${card}`)
}
function rig(seed: Hex) {
  const driver = new RaceDriver({ seed, playerHorseId: 2, stakeTier: 0 }, opts)
  let now = 0
  driver.update(now)
  const until = (condition: () => boolean) => {
    let steps = 0
    while (!condition() && steps++ < 6000) driver.update(now += 250)
    expect(condition()).toBe(true)
  }
  const step = (ms = 250) => driver.update(now += ms)
  return { driver, until, step }
}

for (let id = 1; id <= 26; id++) test(`免费试玩 C-${String(id).padStart(2, '0')} 从实际候选选取后，完整结果与下注求时器逐字段一致`, () => {
  const r = rig(offering(id)), d = r.driver
  r.until(() => d.state.pending !== null)
  expect(d.state.pending!.candidates).toContain(paidCardKey(id))
  d.input({ kind: 'pick', cardId: paidCardKey(id) })
  r.until(() => d.canonicalResult().acquiredByCheckpoint[0] === id)
  for (let sample = 0; sample < 8; sample++) {
    r.step(250)
    const reference = solvePaidCore(d.replayInput)
    const tau = tauAtWall(reference.trace!, BigInt(Math.floor(d.elapsedWallMs)))
    for (let h = 0; h < 5; h++) {
      const expected = sampleHorse(reference.trace!, h, tau)
      expect(d.state.horses[h].pos).toBe(demoPos(expected.pos))
      expect(d.state.horses[h].v).toBe(demoSpeed(expected.v))
      expect(d.state.horses[h].stamina).toBe(demoStamina(expected.stamina))
      expect(d.state.horses[h].laneIndex).toBe(expected.lane)
    }
  }
  r.until(() => d.phase === 'done')
  const canonical = solvePaidCore(d.replayInput)
  expect(d.canonicalResult()).toEqual(canonical)
  expect(d.buildResult('local-test')).toEqual(paidRaceResult('local-test', d.replayInput.seed, 2, canonical))
  expect(d.state.pending).toBeNull()
  expect(d.state.forcedRank?.rank ?? d.state.horses[2].rank).toBe(canonical.settlementRank)
})

test('刷新消耗同一额度、取同一牌尾，重复刷新同槽不能改变候选', () => {
  const r = rig(offering(5)), d = r.driver
  r.until(() => d.state.pending !== null)
  d.input({ kind: 'pick', cardId: 'C-05' })
  r.until(() => d.state.pending?.checkpoint === 1)
  const credits = d.state.refreshCredits
  expect(credits).toBeGreaterThan(0)
  d.input({ kind: 'refresh', slot: 0 }); r.step()
  expect(d.state.pending!.candidates[0]).toBe(paidCardKey(d.replayInput.playerDeck[13]))
  const refreshed = [...d.state.pending!.candidates]
  d.input({ kind: 'refresh', slot: 0 }); r.step()
  expect(d.state.pending!.candidates).toEqual(refreshed)
  d.input({ kind: 'pick', cardId: refreshed[0] })
  r.until(() => d.replayInput.choices[1] !== null)
  expect(d.replayInput.choices[1]!.refreshSlots).toEqual([0])
  expect(d.canonicalResult().checkpoints[1]!.invalidReason).toBe(0)
})

test('自动选择面板不接受手动选牌，断卡关闭后续面板，超时不记录虚构选择', () => {
  for (const id of [3, 4]) {
    const r = rig(offering(id)), d = r.driver
    r.until(() => d.state.pending !== null)
    d.input({ kind: 'pick', cardId: paidCardKey(id) })
    r.until(() => d.canonicalResult().acquiredByCheckpoint[0] === id)
    if (id === 4) {
      r.until(() => d.state.pending?.checkpoint === 1)
      expect(d.state.drawMode).toBe('auto')
      expect(d.choiceInteraction.autoPick).not.toBeNull()
      d.input({ kind: 'pick', cardId: d.state.pending!.candidates[0] }); r.step()
      expect(d.replayInput.choices[1]).toBeNull()
    }
    r.until(() => d.phase === 'done')
    expect(d.canonicalResult().checkpoints[1]!.reason).toBe(id === 3 ? 'cut' : 'auto')
  }
  const r = rig(seed)
  r.until(() => r.driver.phase === 'done')
  expect(r.driver.replayInput.choices).toEqual([null, null, null])
  expect(r.driver.canonicalResult().checkpoints.filter((c) => c.reached).every((c) => c.reason === 'timeout' || c.reason === 'finished')).toBe(true)
})

test('免费试玩集齐版本答案，结算与冲线反馈使用特殊第一名，保留物理顺序', () => {
  let comboSeed: Hex | null = null
  for (let i = 0; i < 5000; i++) {
    const s = keccak256(toBytes(`practice-combo-${i}`))
    const deck = derivePaidDeck(s, keccak256(toBytes(`practice.open:${s}`)))
    if (deck.slice(0, 3).includes(17) && deck.slice(3, 6).includes(19) && deck.slice(6, 9).includes(21)) { comboSeed = s; break }
  }
  expect(comboSeed).not.toBeNull()
  const r = rig(comboSeed!), d = r.driver
  for (const [index, id] of [17, 19, 21].entries()) {
    r.until(() => d.state.pending?.checkpoint === index)
    d.input({ kind: 'pick', cardId: paidCardKey(id) })
    r.until(() => d.canonicalResult().acquiredByCheckpoint[index] === id)
  }
  r.until(() => d.state.playerFinished)
  expect(d.state.forcedRank).toEqual({ horseId: 2, rank: 1 })
  expect(d.buildResult('local-combo').rank).toBe(1)
  expect(d.buildResult('local-combo').endReason).toBe('forced-combo')
  const canonical = solvePaidCore(d.replayInput)
  expect(d.canonicalResult().rawOrder).toEqual(canonical.rawOrder)
  expect(d.canonicalResult().settlementOrder).toEqual(canonical.settlementOrder)
})
