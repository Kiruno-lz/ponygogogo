import { describe, expect, test } from 'bun:test'
import { keccak256, toHex, type Hex } from 'viem'
import type { ClockEstimate } from '../chain/chainClock.ts'
import type { ChoiceOutcome, PaidChoiceFact, PaidSessionFacts, PaidTxStep } from '../chain/paidSession.ts'
import { derivePaidDeck, FULL_CARD_MASK } from './core/paidDeck.ts'
import type { RaceEvent } from './core/types.ts'
import { sampleHorse, tauAtWall, wallAtTau } from './paid/trace.ts'
import type { PaidCheckpointRecord } from './paid/solver.ts'
import { ignoredChoiceOutcome, PaidRaceDriver, type SubmitChoice } from './paidDriver.ts'
import { solveFromFacts } from './paidResult.ts'
import { demoPos, demoSpeed, demoStamina, paidCardKey } from './paidSnapshot.ts'

const T0 = 1_790_000_000
const TIMING = { latencyMs: 700, marginMs: 2000 }

/** chain time = local + T0·1000 + skew; wall therefore equals local + skew */
class FakeClock {
  skew = 0
  err = 0
  estimate(local: number): ClockEstimate {
    const mid = local + T0 * 1000 + this.skew
    return { lo: mid - this.err, mid, hi: mid + this.err, errorMs: this.err, synced: true }
  }
}

function facts(anchor: Hex, choices: PaidSessionFacts['choices'] = [null, null, null], horseId = 1, tier: 1 | 2 | 3 | 4 = 2): PaidSessionFacts {
  return {
    sessionId: keccak256(toHex(`session:${anchor}`)), player: '0x00000000000000000000000000000000000000a1', state: 1,
    horseId, stakeTier: tier, stake: 10n ** 17n, seed: keccak256(toHex('p7-driver-seed')), openedAt: T0,
    openedBlock: 100n, openAnchor: anchor, choices,
  }
}

type Call = { k: 1 | 2 | 3; cardId: number; slots: number[]; resolve: (o: ChoiceOutcome) => void }

function rig(f: PaidSessionFacts, opts: { countdownMs?: number } = {}) {
  const clock = new FakeClock()
  const calls: Call[] = []
  const submitChoice: SubmitChoice = (k, cardId, slots, onStep: (s: PaidTxStep) => void) => new Promise((resolve) => {
    onStep({ phase: 'submitted', callId: `call-${k}` })
    calls.push({ k, cardId, slots, resolve })
  })
  const driver = new PaidRaceDriver({
    playerHorseId: f.horseId, stakeTier: f.stakeTier, clock, timing: TIMING, submitChoice,
    countdownMs: opts.countdownMs ?? 0, correctionMs: 700,
  })
  const events: RaceEvent[] = []
  let local = 0
  const runTo = (until: number, step = 16) => {
    for (; local < until; local = Math.min(until, local + step)) events.push(...driver.update(local))
    events.push(...driver.update(local))
  }
  return { clock, calls, driver, events, runTo, get local() { return local } }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function included(k: 1 | 2 | 3, cardId: number, txSec: number, anchor: Hex): ChoiceOutcome {
  const choice: PaidChoiceFact = { checkpoint: k, cardId, refreshSlots: [], txSec, blockNumber: 200n + BigInt(k), anchor }
  return { state: 'included', choice, hash: keccak256(toHex(`tx${k}`)), submittedAt: 0 }
}

/** First anchor (deterministic scan) whose opening deck offers `card` at checkpoint 1. */
function anchorOffering(card: number | null, avoid: number[] = [3, 4]): Hex {
  for (let i = 0; i < 400; i++) {
    const anchor = keccak256(toHex(`p7-anchor-${i}`))
    const deck = derivePaidDeck(keccak256(toHex('p7-driver-seed')), anchor, FULL_CARD_MASK)
    const first = deck.slice(0, 3)
    if (card !== null && !first.includes(card)) continue
    if (card === null && first.some((c) => avoid.includes(c))) continue
    if (card !== null && deck.slice(3, 6).some((c) => avoid.includes(c))) continue
    return anchor
  }
  throw new Error('no anchor found')
}

const plain = anchorOffering(null)

describe('paid driver: canonical time and snapshots', () => {
  test('before the entry lands it shows the countdown at ≥1 s and idle horses; a failed entry releases it', () => {
    const r = rig(facts(plain), { countdownMs: 3000 })
    r.runTo(5000)
    expect(r.driver.phase).toBe('countdown')
    expect(r.driver.countdownLeft).toBeGreaterThanOrEqual(1000)
    expect(r.driver.state.horses.every((h) => h.pos === 0)).toBe(true)
    r.driver.failEntry('rejected')
    r.runTo(5100)
    expect(r.driver.countdownLeft).toBe(0)
    expect(r.driver.entryFailedState).toBe(true)
  })

  test('each frame samples the solver trace at τ = tauAtWall(chain now − T0)', () => {
    const f = facts(plain)
    const r = rig(f)
    r.driver.open(f)
    r.runTo(12_000)
    const res = solveFromFacts(f, {})
    const tau = tauAtWall(res.trace!, 12_000n)
    expect(r.driver.debugDisplay.wall).toBe(12_000)
    for (let h = 0; h < 5; h++) expect(r.driver.state.horses[h]!.pos).toBe(demoPos(sampleHorse(res.trace!, h, tau).pos))
    expect(r.driver.phase).toBe('racing')
    expect(r.events.filter((e) => e.type === 'checkpoint').length).toBe(0)
  })

  test('paid display samples the same 250ms overlapping-well trajectory as the contract oracle', () => {
    // This production input also runs through the deployed Solver in paid-session-anvil.test.ts.
    const f = facts('0xee2f19d2d601b98cfc8b613200766bb21cbc4294476db78e9372d2f52a7a7f2e', [null, null, null], 1, 1)
    f.seed = '0x8486a37a59c4f66a573ec56d925ee0ed39ad950970db563e1877bfbcd8205a5b'
    const result = solveFromFacts(f, {})
    const trace = result.trace!
    const wells = trace.instances.filter((i) => i.cardId === 10 && i.kind === 'equip')
    const overlap = wells[1]!.startTau
    const frame = trace.keyframes[1]!.find((s) => s.tau0 >= overlap && s.tau1 - s.tau0 === 250n)!
    expect(frame).toBeDefined()
    const r = rig(f)
    r.driver.open(f)
    for (const tau of [frame.tau0, frame.tau0 + 125n, frame.tau1, wells[0]!.endTau! - 1n, wells[1]!.endTau!]) {
      const wall = Number(wallAtTau(trace, tau))
      r.runTo(wall)
      expect(r.driver.debugDisplay.wall).toBe(wall)
      for (let h = 0; h < 5; h++) {
        const expected = sampleHorse(trace, h, tau)
        expect(r.driver.state.horses[h]).toMatchObject({
          pos: demoPos(expected.pos), v: demoSpeed(expected.v), stamina: demoStamina(expected.stamina),
        })
      }
      for (const well of wells) expect(r.driver.state.effects.some((e) => e.sourceCardId === 'C-10' && e.ownerHorseId === well.horse))
        .toBe(well.startTau <= tau && tau < well.endTau!)
    }
  })

  test('the visual countdown holds the picture at the start line, then the display catches up at ≤ 3× speed', () => {
    const f = facts(plain)
    const r = rig(f, { countdownMs: 3000 })
    r.driver.open(f)
    r.runTo(2_900)
    expect(r.driver.phase).toBe('countdown')
    expect(r.driver.debugDisplay.wall).toBe(0)
    let prev = r.driver.debugDisplay.wall
    for (let t = 3_000; t < 9_000; t += 16) {
      r.runTo(t)
      const w = r.driver.debugDisplay.wall
      expect(w - prev).toBeLessThanOrEqual(16 * 3 + 1e-6)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
    expect(Math.abs(r.driver.debugDisplay.wall - 9_000)).toBeLessThan(50)
  })

  test('clock re-estimates slew instead of jumping; a gap over 5 s snaps without replaying events', () => {
    const f = facts(plain)
    const r = rig(f)
    r.driver.open(f)
    r.runTo(6_000)
    r.clock.skew = -400
    r.runTo(6_016)
    expect(r.driver.debugDisplay.wall).toBeGreaterThan(6_000)
    r.runTo(9_000)
    expect(Math.abs(r.driver.debugDisplay.wall - 8_600)).toBeLessThan(40)
    const before = r.events.length
    r.clock.skew = 60_000
    r.runTo(9_016)
    expect(r.driver.debugDisplay.wall).toBe(69_016)
    const replayed = r.events.slice(before)
    expect(replayed.filter((e) => e.type === 'checkpoint').length).toBeLessThanOrEqual(5)
  })

  test('gogo only produces a feedback event; the rule state does not change', () => {
    const f = facts(plain)
    const r = rig(f)
    r.driver.open(f)
    r.runTo(4_000)
    const before = r.driver.state.horses.map((h) => h.pos)
    r.driver.input({ kind: 'gogoDown' })
    const ev = r.driver.update(4_000)
    expect(ev.map((e) => e.type)).toEqual(['gogo'])
    expect(r.driver.state.horses.map((h) => h.pos)).toEqual(before)
  })

  test('连续 gogo 不改变有奖体力、轨迹和完整求解结果，也不提交链上选择', () => {
    const f = facts(plain)
    const idle = rig(f), clicked = rig(f)
    idle.driver.open(f)
    clicked.driver.open(f)
    for (let now = 0; now <= 12_000; now += 20) {
      idle.driver.update(now)
      if (now % 200 === 0) {
        clicked.driver.input({ kind: 'gogoDown' })
        clicked.driver.input({ kind: 'gogoUp' })
      }
      clicked.driver.update(now)
    }
    expect(clicked.driver.state.horses).toEqual(idle.driver.state.horses)
    expect(clicked.driver.preview()!.result).toEqual(idle.driver.preview()!.result)
    expect(clicked.calls).toEqual([])
  })
})

describe('paid driver: choice window', () => {
  const f = facts(plain)
  const rec1 = solveFromFacts(f).checkpoints[0]!
  const openWall = Number(rec1.openWall)
  const openSec = Number(rec1.openSec)

  test('the panel opens at openWall; a click before openSec queues and is sent once the lower bound passes it', async () => {
    expect(rec1.mode).toBe('manual')
    const r = rig(f)
    r.driver.open(f)
    r.runTo(openWall - 16)
    expect(r.driver.state.pending).toBeNull()
    r.runTo(openWall + 1)
    const pending = r.driver.state.pending!
    expect(pending.checkpoint).toBe(0)
    expect(pending.candidates).toEqual(rec1.candidates.map(paidCardKey))
    expect(r.driver.slowmo).toBe(true)
    expect(r.driver.choiceLeftMs).toBe(openSec * 1000 + 20_000 - TIMING.marginMs - (openWall + 1))
    const card = rec1.candidates[1]!
    if (openWall + 1 < openSec * 1000) {
      r.driver.input({ kind: 'pick', cardId: paidCardKey(card) })
      expect(r.driver.overlay.choice?.status).toBe('queued')
      expect(r.calls).toHaveLength(0)
      r.runTo(openSec * 1000 - 16)
      expect(r.calls).toHaveLength(0)
    }
    r.runTo(openSec * 1000)
    if (r.calls.length === 0) r.driver.input({ kind: 'pick', cardId: paidCardKey(card) })
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]).toMatchObject({ k: 1, cardId: card, slots: [] })
    expect(r.driver.overlay.choice?.status).toBe('submitted')
    // the panel closes on click; the world keeps the canonical slow motion until the predicted block second
    r.runTo(openSec * 1000 + 16)
    expect(r.driver.state.pending).toBeNull()
    r.calls[0]!.resolve(included(1, card, openSec, keccak256(toHex('block-1'))))
    await flush()
    r.runTo(openSec * 1000 + 300)
    expect(r.driver.overlay.choice?.status).toBe('included')
    expect(r.driver.sessionFacts?.choices[0]?.txSec).toBe(openSec)
    expect(r.driver.preview()?.result.checkpoints[0]).toMatchObject({ reason: 'picked', cardId: card })
  })

  test('a receipt later than predicted re-solves and corrects smoothly within correctionMs', async () => {
    const r = rig(f)
    r.driver.open(f)
    r.runTo(openSec * 1000 + 10)
    const card = rec1.candidates[0]!
    r.driver.input({ kind: 'pick', cardId: paidCardKey(card) })
    expect(r.calls).toHaveLength(1)
    r.runTo(openSec * 1000 + 3_000)
    const before = r.driver.state.horses.map((h) => h.pos)
    // the block landed two seconds later than the optimistic guess
    r.calls[0]!.resolve(included(1, card, openSec + 2, keccak256(toHex('block-late'))))
    await flush()
    r.runTo(openSec * 1000 + 3_016)
    const after = r.driver.state.horses.map((h) => h.pos)
    const truth = solveFromFacts(r.driver.sessionFacts!, {})
    const tau = tauAtWall(truth.trace!, BigInt(Math.floor(r.driver.debugDisplay.wall)))
    const pure = [0, 1, 2, 3, 4].map((h) => demoPos(sampleHorse(truth.trace!, h, tau).pos))
    const perFrame = Math.max(...before.map((b, h) => Math.abs(after[h]! - b)))
    const jump = Math.max(...after.map((a, h) => Math.abs(a - pure[h]!)))
    // continuity: no frame jumps to the new trajectory at once
    expect(jump).toBeGreaterThan(0)
    expect(perFrame).toBeLessThan(jump)
    r.runTo(openSec * 1000 + 3_016 + 720)
    const settled = solveFromFacts(r.driver.sessionFacts!, {})
    const tau2 = tauAtWall(settled.trace!, BigInt(Math.floor(r.driver.debugDisplay.wall)))
    for (let h = 0; h < 5; h++) expect(r.driver.state.horses[h]!.pos).toBe(demoPos(sampleHorse(settled.trace!, h, tau2).pos))
  })

  test('a rejected choice re-solves as a timeout and the still-open panel accepts another click', async () => {
    const r = rig(f)
    r.driver.open(f)
    r.runTo(openSec * 1000 + 10)
    r.driver.input({ kind: 'pick', cardId: paidCardKey(rec1.candidates[2]!) })
    r.calls[0]!.resolve({ state: 'rejected', reason: 'ChoiceWindowClosed', hash: null, submittedAt: 0 })
    await flush()
    r.runTo(openSec * 1000 + 1_000)
    expect(r.driver.overlay.choice).toMatchObject({ status: 'rejected', reason: 'ChoiceWindowClosed' })
    expect(r.driver.preview()?.result.checkpoints[0]?.reason).toBe('timeout')
    expect(r.driver.state.pending).not.toBeNull()
    r.driver.input({ kind: 'pick', cardId: null })
    expect(r.calls).toHaveLength(2)
    expect(r.calls[1]).toMatchObject({ k: 1, cardId: 0, slots: [] })
  })

  test('an included receipt past the window is ignored: the checkpoint renders as a timeout and stays closed', async () => {
    const r = rig(f)
    r.driver.open(f)
    r.runTo(openSec * 1000 + 10)
    const card = rec1.candidates[0]!
    r.driver.input({ kind: 'pick', cardId: paidCardKey(card) })
    // the block landed at openSec + 20: stored on chain, but outside [openSec, openSec + 20)
    r.calls[0]!.resolve(included(1, card, openSec + 20, keccak256(toHex('block-too-late'))))
    await flush()
    r.runTo(openSec * 1000 + 1_000)
    expect(r.driver.overlay.choice).toMatchObject({ checkpoint: 1, status: 'ignored', reason: 'late', outcome: 'timeout' })
    expect(r.driver.sessionFacts?.choices[0]?.txSec).toBe(openSec + 20)
    expect(r.driver.preview()?.result.checkpoints[0]).toMatchObject({ reason: 'timeout', cardId: 0, invalidReason: 3 })
    // the stored choice is final on chain (lastCheckpoint moved on): no panel, no second transaction
    expect(r.driver.state.pending).toBeNull()
    r.driver.input({ kind: 'pick', cardId: paidCardKey(rec1.candidates[1]!) })
    expect(r.calls).toHaveLength(1)
    expect(r.driver.slowmo).toBe(true)
    r.runTo(openSec * 1000 + 20_050)
    expect(r.driver.slowmo).toBe(false)
    expect(ignoredChoiceOutcome({ reason: 'cut' } as PaidCheckpointRecord)).toBe('cut')
    expect(ignoredChoiceOutcome({ reason: 'finished' } as PaidCheckpointRecord)).toBe('none')
  })

  test('after openSec + 20 − margin the panel is locked, clicks are ignored and it closes on the timeout', () => {
    const r = rig(f)
    r.driver.open(f)
    const cutoff = openSec * 1000 + 20_000 - TIMING.marginMs
    r.runTo(cutoff)
    expect(r.driver.overlay.locked).toBe(true)
    expect(r.driver.choiceLeftMs).toBe(0)
    r.driver.input({ kind: 'pick', cardId: paidCardKey(rec1.candidates[0]!) })
    r.driver.input({ kind: 'refresh', slot: 0 })
    expect(r.calls).toHaveLength(0)
    r.runTo(openSec * 1000 + 20_000 + 50)
    expect(r.driver.state.pending).toBeNull()
    expect(r.driver.slowmo).toBe(false)
  })
})

describe('paid driver: draw rules and recovery', () => {
  test('after C-04 the next panel is automatic: it shows the auto pick and takes no input', async () => {
    const anchor = anchorOffering(4)
    const f = facts(anchor)
    const rec1 = solveFromFacts(f).checkpoints[0]!
    const r = rig(f)
    r.driver.open(f)
    r.runTo(Number(rec1.openSec) * 1000 + 10)
    r.driver.input({ kind: 'pick', cardId: 'C-04' })
    r.calls[0]!.resolve(included(1, 4, Number(rec1.openSec), keccak256(toHex('auto-anchor'))))
    await flush()
    r.runTo(Number(rec1.openSec) * 1000 + 100)
    const rec2 = r.driver.preview()!.result.checkpoints[1]!
    expect(rec2.mode).toBe('auto')
    r.runTo(Number(rec2.openWall) + 5)
    expect(r.driver.state.drawMode).toBe('auto')
    expect(r.driver.state.pending?.candidates).toEqual(rec2.candidates.map(paidCardKey))
    expect(r.driver.overlay.autoPick).toBe(rec2.candidates.indexOf(rec2.cardId))
    r.driver.input({ kind: 'pick', cardId: paidCardKey(rec2.candidates[0]!) })
    expect(r.calls).toHaveLength(1)
  })

  test('after C-03 the next checkpoint is cut: no panel, a short notice, no slow motion', async () => {
    const anchor = anchorOffering(3)
    const f = facts(anchor)
    const rec1 = solveFromFacts(f).checkpoints[0]!
    const r = rig(f)
    r.driver.open(f)
    r.runTo(Number(rec1.openSec) * 1000 + 10)
    r.driver.input({ kind: 'pick', cardId: 'C-03' })
    r.calls[0]!.resolve(included(1, 3, Number(rec1.openSec), keccak256(toHex('cut-anchor'))))
    await flush()
    r.runTo(Number(rec1.openSec) * 1000 + 100)
    const rec2 = r.driver.preview()!.result.checkpoints[1]!
    expect(rec2.mode).toBe('cut')
    r.runTo(Number(rec2.openWall) + 5)
    expect(r.driver.overlay.cut).toBe(2)
    expect(r.driver.state.pending).toBeNull()
    expect(r.driver.slowmo).toBe(false)
  })

  test('resume lands on the current canonical moment with on-chain choices and replays no past events', () => {
    const base = facts(plain)
    const rec1 = solveFromFacts(base).checkpoints[0]!
    const card = rec1.candidates[0]!
    const withChoice = facts(plain, [
      { checkpoint: 1, cardId: card, refreshSlots: [], txSec: Number(rec1.openSec) + 1, blockNumber: 150n, anchor: keccak256(toHex('b150')) },
      null, null,
    ])
    const r = rig(withChoice, { countdownMs: 3000 })
    r.runTo(40_000)
    r.driver.open(withChoice, { resume: true })
    r.runTo(40_016)
    expect(r.driver.phase).not.toBe('countdown')
    expect(Math.abs(r.driver.debugDisplay.wall - 40_016)).toBeLessThan(20)
    expect(r.events.filter((e) => e.type === 'checkpoint' || e.type === 'cardPicked')).toEqual([])
    expect(r.driver.preview()!.result.checkpoints[0]).toMatchObject({ reason: 'picked', cardId: card })
  })

  test('the race ends on the trace: finish events fire once each and the phase reaches done', () => {
    const f = facts(plain)
    const r = rig(f)
    r.driver.open(f)
    const end = Number(solveFromFacts(f).finishWall.reduce((a, b) => (a > b ? a : b)))
    r.runTo(end + 200, 250)
    expect(r.events.filter((e) => e.type === 'finish').length).toBe(5)
    expect(r.driver.phase).toBe('done')
    expect(r.driver.state.playerFinished).toBe(true)
    expect(r.driver.playerFinishWall).toBe(Number(solveFromFacts(f).finishWall[1]))
  })
})

describe('paid driver: reconciliation and accessors', () => {
  test('entry steps are exposed; a failed step marks the entry failed', () => {
    const r = rig(facts(plain))
    r.driver.setEntryStep({ phase: 'submitted', callId: 'c' })
    expect(r.driver.overlay.entry).toEqual({ phase: 'submitted', callId: 'c' })
    expect(r.driver.entryFailedState).toBe(false)
    r.driver.setEntryStep({ phase: 'failed', hash: null, reason: 'reverted' })
    expect(r.driver.entryFailedState).toBe(true)
    expect(r.driver.preview()).toBeNull()
    expect(r.driver.canonicalResult()).toBeNull()
    expect(r.driver.playerFinishWall).toBeNull()
    expect(() => r.driver.open(facts(plain, [null, null, null], 0))).toThrow('PAID_DRIVER_MISMATCH')
  })

  test('reconcile adopts chain facts, drops a superseded optimistic pick and ignores a stale outcome', async () => {
    const f = facts(plain)
    const rec1 = solveFromFacts(f).checkpoints[0]!
    const r = rig(f)
    r.driver.open(f)
    r.runTo(Number(rec1.openSec) * 1000 + 10)
    r.driver.input({ kind: 'pick', cardId: paidCardKey(rec1.candidates[0]!) })
    expect(r.calls).toHaveLength(1)
    const onChain = facts(plain, [
      { checkpoint: 1, cardId: rec1.candidates[0]!, refreshSlots: [], txSec: Number(rec1.openSec) + 1, blockNumber: 120n, anchor: keccak256(toHex('b120')) },
      null, null,
    ])
    r.driver.reconcile(facts(keccak256(toHex('other-anchor'))))
    expect(r.driver.sessionFacts?.choices[0]).toBeNull()
    r.driver.reconcile(onChain)
    expect(r.driver.sessionFacts?.choices[0]?.txSec).toBe(Number(rec1.openSec) + 1)
    // the late receipt of the superseded optimistic pick changes nothing
    r.calls[0]!.resolve(included(1, rec1.candidates[0]!, Number(rec1.openSec) + 5, keccak256(toHex('stale'))))
    await flush()
    expect(r.driver.sessionFacts?.choices[0]?.txSec).toBe(Number(rec1.openSec) + 1)
    expect(r.driver.canonicalResult()!.digest).toBe(solveFromFacts(onChain).digest)
    r.runTo(Number(rec1.openSec) * 1000 + 100)
    expect(r.driver.chainWall.mid).toBe(Number(rec1.openSec) * 1000 + 100)
  })

  test('refresh preview: with C-05 held, a slot swaps to the deck tail and the pick sends that slot', async () => {
    const anchor = anchorOffering(5)
    const f = facts(anchor)
    const rec1 = solveFromFacts(f).checkpoints[0]!
    const r = rig(f)
    r.driver.open(f)
    r.runTo(Number(rec1.openSec) * 1000 + 10)
    // no credit yet at checkpoint 1: the refresh is ignored
    r.driver.input({ kind: 'refresh', slot: 0 })
    r.runTo(r.local + 16)
    expect(r.driver.state.pending?.refreshesUsed).toEqual([])
    r.driver.input({ kind: 'pick', cardId: 'C-05' })
    r.calls[0]!.resolve(included(1, 5, Number(rec1.openSec), keccak256(toHex('refresh-anchor'))))
    await flush()
    const rec2 = r.driver.preview()!.result.checkpoints[1]!
    expect(rec2.mode).toBe('manual')
    r.runTo(Number(rec2.openSec) * 1000 + 10)
    expect(r.driver.state.refreshCredits).toBe(1)
    r.driver.input({ kind: 'refresh', slot: 1 })
    // a pick in the same frame already sees the refreshed offer
    const deck = derivePaidDeck(keccak256(toHex('p7-driver-seed')), anchor, FULL_CARD_MASK)
    const replacement = paidCardKey(deck[13]!)
    r.runTo(r.local + 16)
    const refreshed = r.driver.state.pending!
    expect(refreshed.refreshesUsed).toEqual([1])
    expect(refreshed.candidates[1]).toBe(replacement)
    expect(r.driver.state.refreshCredits).toBe(0)
    r.driver.input({ kind: 'refresh', slot: 2 })
    r.runTo(r.local + 16)
    expect(r.driver.state.pending!.refreshesUsed).toEqual([1])
    // the card refreshed away is no longer pickable; the replacement is
    r.driver.input({ kind: 'pick', cardId: paidCardKey(rec2.candidates[1]!) })
    expect(r.calls).toHaveLength(1)
    r.driver.input({ kind: 'pick', cardId: replacement })
    expect(r.calls[1]).toMatchObject({ k: 2, slots: [1], cardId: deck[13] })
  })
})
