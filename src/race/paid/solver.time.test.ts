import { describe, expect, test } from 'bun:test'
import { resolvePaidAutomaticChoice } from '../core/paidDrawRules.ts'
import {
  EV_BASE_CAP, EV_CHOICE_INVALID, EV_PANEL_CLOSE, EV_PANEL_DEFER, foldPaidEvent, INVALID_AFTER_FINISH, INVALID_AUTO,
  INVALID_EARLY, INVALID_LATE, INVALID_NOT_OFFERED, INVALID_NOT_OPENED, ZERO_DIGEST,
} from './events.ts'
import { checkPaidChoice, classifyPaidChoice, solvePaidCore, type PaidCoreInput } from './solver.ts'
import { fixtureAnchor, fixtureInput, fixtureProfiles, ignoredChoice, pickAt, withSlot } from './testkit.ts'
import { wallAtTau, tauAtWall } from './trace.ts'

const quiet = fixtureInput()

function slot(txSec: bigint, cardId = 0, anchor = fixtureAnchor(0x31)) {
  return { txSec, cardId, refreshSlots: [], anchor }
}

describe('time mapping', () => {
  test('first panel opens at the canonical crossing and times out at (openSec + 20)·1000', () => {
    const r = solvePaidCore(quiet)
    expect(r.checkpoints[0]).toMatchObject({
      reached: true, mode: 'manual', openTau: 19_024n, openWall: 19_024n, openSec: 20n, deadlineSec: 40n,
      closeWall: 40_000n, closeTau: 19_024n + (40_000n - 19_024n) / 10n, reason: 'timeout', cardId: 0,
    })
    expect(r.checkpoints.map((c) => c.openWall)).toEqual([19_024n, 54_280n, 87_527n])
  })

  test('every horse runs at 0.1× while the panel is open: wall = openWall + 10·(τ − τOpen)', () => {
    const r = solvePaidCore(quiet)
    const third = r.checkpoints[2]!
    const inside = r.events.filter((e) => e.code === EV_BASE_CAP && e.tau > third.openTau && e.tau < third.closeTau)
    expect(inside.map((e) => e.horse)).toEqual([0, 2, 3])
    for (const e of inside) {
      expect(e.wall).toBe(third.openWall + 10n * (e.tau - third.openTau))
      expect(wallAtTau(r.trace!, e.tau)).toBe(e.wall)
    }
    const after = r.events.find((e) => e.tau > third.closeTau)!
    expect(after.wall).toBe(third.closeWall + (after.tau - third.closeTau))
  })

  test('a real choice closes at txSec·1000 and takes effect at τOpen + floor((closeWall − openWall)/10)', () => {
    const r = solvePaidCore(withSlot(quiet, 1, slot(25n)))
    expect(r.checkpoints[0]).toMatchObject({ reason: 'forfeit-tx', closeWall: 25_000n, closeTau: 19_024n + 597n })
    const close = r.events.find((e) => e.code === EV_PANEL_CLOSE)!
    expect(close).toMatchObject({ tau: 19_621n, wall: 25_000n, arg: 16n + 2n })
    // After the close the mapping restarts at (τClose, closeWall) with dτ/dt = 1.
    expect(r.checkpoints[1]!.openTau).toBe(35_401n)
    expect(r.checkpoints[1]!.openWall).toBe(25_000n + (35_401n - 19_621n))
  })

  test('the choice window is [openSec, openSec + 20) in whole seconds; outside it the choice is ignored', () => {
    expect(ignoredChoice(withSlot(quiet, 1, slot(19n)), 1)).toEqual({ reason: INVALID_EARLY, equivalent: true })
    expect(ignoredChoice(withSlot(quiet, 1, slot(40n)), 1)).toEqual({ reason: INVALID_LATE, equivalent: true })
    expect(ignoredChoice(withSlot(quiet, 1, slot(0n)), 1)).toEqual({ reason: INVALID_EARLY, equivalent: true })
    expect(ignoredChoice(withSlot(quiet, 1, slot(0xffff_ffffn)), 1)).toEqual({ reason: INVALID_LATE, equivalent: true })
    // Logged right after the PANEL_OPEN that judged it, at the same τ; the panel then times out.
    const late = solvePaidCore(withSlot(quiet, 1, slot(40n)))
    const at = late.events.findIndex((e) => e.code === EV_CHOICE_INVALID)
    expect(late.events[at - 1]).toMatchObject({ code: 5, tau: 19_024n, arg: 1n })
    expect(late.events[at]).toMatchObject({ tau: 19_024n, horse: 1, arg: 16n + BigInt(INVALID_LATE) })
    expect(late.checkpoints[0]).toMatchObject({ reason: 'timeout', closeWall: 40_000n, invalidReason: INVALID_LATE })
    expect(solvePaidCore(withSlot(quiet, 1, slot(20n))).checkpoints[0]!.closeTau).toBe(19_024n + 97n)
    expect(solvePaidCore(withSlot(quiet, 1, slot(39n))).checkpoints[0]!.closeTau).toBe(19_024n + 1_997n)
  })

  test('C-04 auto panel lasts 3 s and draws from the last real-choice anchor', () => {
    const deck = [4, 17, 18, 19, 14, 15, 20, 21, 1, 2, 6, 7, 8, 10]
    const input = pickAt(fixtureInput({ playerDeck: deck }), 1, 4, { anchor: fixtureAnchor(0x41) })
    const r = solvePaidCore(input)
    const second = r.checkpoints[1]!
    expect(second.mode).toBe('auto')
    expect(second.deadlineSec).toBe(second.openSec + 3n)
    expect(second.closeWall).toBe((second.openSec + 3n) * 1000n)
    expect(second.closeTau).toBe(second.openTau + (second.closeWall - second.openWall) / 10n)
    const expected = resolvePaidAutomaticChoice(deck, { cursor: 3, tailCursor: 14, refreshCredits: 0, automatic: true, forfeited: false },
      input.seed, fixtureAnchor(0x41), 2)
    expect(second).toMatchObject({ reason: 'auto', cardId: expected.cardId })
    expect(r.checkpoints[2]!.reason).toBe('auto')
    expect(r.acquired).toEqual([4, 19, 20])
    expect(ignoredChoice(withSlot(input, 2, slot(second.openSec)), 2)).toEqual({ reason: INVALID_AUTO, equivalent: true })
  })

  test('a threshold reached while a panel is open opens the next panel at that panel\'s close', () => {
    const profiles = fixtureProfiles()
    profiles[1] = { base: 14_000n, acceleration: 0n, cap: 14_000n }
    const input = fixtureInput({ profiles })
    const r = solvePaidCore(input)
    const [one, two, three] = r.checkpoints
    expect(r.events.filter((e) => e.code === EV_PANEL_DEFER).map((e) => e.arg)).toEqual([2n, 3n])
    expect(two!.openTau).toBe(one!.closeTau)
    expect(two!.openWall).toBe(one!.closeWall)
    expect(two!.openSec).toBe(one!.closeWall / 1000n)
    expect(three!.openTau).toBe(two!.closeTau)
    // The player reaches the line inside the third panel: that panel closes at the finish with no card.
    expect(three).toMatchObject({ reason: 'finished', closeTau: r.finishTime[1] })
    expect(three!.closeWall).toBe(three!.openWall + 10n * (r.finishTime[1]! - three!.openTau))
    expect(r.finishWall[1]).toBe(three!.closeWall)
    const late = withSlot(input, 3, slot(three!.openSec + 19n))
    expect(ignoredChoice(late, 3)).toEqual({ reason: INVALID_AFTER_FINISH, equivalent: true })
    const events = solvePaidCore(late).events
    const close = events.findIndex((e) => e.code === EV_PANEL_CLOSE && e.arg === 3n * 16n + 5n)
    expect(events.slice(close, close + 2).map((e) => [e.code, e.tau, e.arg])).toEqual([
      [EV_PANEL_CLOSE, r.finishTime[1]!, 3n * 16n + 5n], [EV_CHOICE_INVALID, r.finishTime[1]!, 3n * 16n + 4n],
    ])
    const probe = solvePaidCore(input, { untilWall: (three!.openSec + 19n) * 1000n })
    expect(probe.panel).toBeNull()
    expect(probe.checkpoints[2]!.reason).toBe('finished')
    // A deferred panel can be chosen like any other.
    const picked = solvePaidCore(pickAt(input, 2, 0, { delaySec: 1n }))
    expect(picked.checkpoints[1]).toMatchObject({ reason: 'forfeit-tx', closeWall: (two!.openSec + 1n) * 1000n })
  })

  test('two thresholds crossed inside one panel open one after another; a deferred cut passes straight on', () => {
    const profiles = fixtureProfiles()
    profiles[1] = { base: 30_000n, acceleration: 0n, cap: 30_000n }
    const input = fixtureInput({ profiles })
    const r = solvePaidCore(input)
    expect(r.events.filter((e) => e.code === EV_PANEL_DEFER).map((e) => e.arg)).toEqual([2n, 3n])
    const [one, two, three] = r.checkpoints
    expect(two!.openTau).toBe(one!.closeTau)
    expect(['timeout', 'finished']).toContain(two!.reason)
    expect(three!.reason).toBe('finished')
    // Picking C-03 at panel 1 cuts both deferred checkpoints at that same close.
    const cut = solvePaidCore(pickAt(fixtureInput({ profiles, playerDeck: [3, 17, 18, 21, 14, 15, 20, 19, 1, 2, 6, 7, 8, 10] }), 1, 3,
      { delaySec: 19n }))
    expect(cut.checkpoints.map((c) => c.reason)).toEqual(['picked', 'cut', 'cut'])
    expect(cut.checkpoints[1]!.openTau).toBe(cut.checkpoints[0]!.closeTau)
    expect(cut.checkpoints[2]!.openTau).toBe(cut.checkpoints[0]!.closeTau)
  })

  test('trace helpers invert the piecewise mapping', () => {
    const r = solvePaidCore(withSlot(quiet, 1, slot(22n)))
    const t = r.trace!
    expect(wallAtTau(t, 10_000n)).toBe(10_000n)
    expect(tauAtWall(t, 10_000n)).toBe(10_000n)
    expect(wallAtTau(t, 19_100n)).toBe(19_024n + 760n)
    expect(tauAtWall(t, 19_024n + 765n)).toBe(19_100n)
    // Sim time freezes at τClose until the close wall.
    const close = r.checkpoints[0]!
    expect(tauAtWall(t, close.closeWall - 1n)).toBe(close.closeTau)
    expect(tauAtWall(t, close.closeWall + 5n)).toBe(close.closeTau + 5n)
  })
})

describe('partial solves', () => {
  const chosen = pickAt(pickAt(fixtureInput({ playerDeck: [7, 17, 18, 1, 21, 14, 11, 15, 20, 19, 2, 6, 8, 10] }), 1, 7), 2, 1)

  test('stopAtPanel reports exactly what the full solve records for that panel', () => {
    const full = solvePaidCore(chosen)
    for (const k of [1, 2, 3] as const) {
      const stop = solvePaidCore(chosen, { stopAtPanel: k })
      expect(stop.status).toBe('panel')
      const rec = full.checkpoints[k - 1]!
      expect(stop.panel).toMatchObject({
        checkpoint: k, mode: 'manual', openTau: rec.openTau, openWall: rec.openWall, openSec: rec.openSec,
        deadlineSec: rec.openSec + 20n,
      })
      expect(stop.tauEnd).toBe(rec.openTau)
      expect(full.events.slice(0, stop.eventCount)).toEqual(stop.events)
    }
    expect(solvePaidCore(chosen, { stopAtPanel: 2 }).panel!.candidates).toEqual([1, 21, 14])
    expect(solvePaidCore(chosen, { stopAtPanel: 3 }).panel!.drawState.cursor).toBe(6)
  })

  test('untilWall yields a prefix of the full log and an identical running digest', () => {
    const full = solvePaidCore(chosen)
    for (const wall of [0n, 5_000n, 19_024n, 19_500n, 45_000n, 70_000n, 200_000n]) {
      const part = solvePaidCore(chosen, { untilWall: wall, trace: false })
      expect(full.events.slice(0, part.eventCount)).toEqual(part.events)
      let digest = ZERO_DIGEST
      for (const e of part.events) digest = foldPaidEvent(digest, e.code, e.tau, e.horse, e.arg)
      expect(part.digest).toBe(digest)
      expect(part.events.every((e) => e.wall <= wall)).toBe(true)
      if (part.status === 'wall') expect(part.wallEnd).toBeLessThanOrEqual(wall)
    }
    expect(solvePaidCore(chosen, { untilWall: 200_000n }).digest).toBe(full.digest)
  })

  test('a panel without a recorded choice stays open until its deadline', () => {
    const open = solvePaidCore(quiet, { untilWall: 39_999n })
    expect(open.status).toBe('wall')
    expect(open.panel).toMatchObject({ checkpoint: 1, mode: 'manual', openSec: 20n, deadlineSec: 40n, candidates: [17, 18, 21] })
    expect(open.checkpoints[0]!.reason).toBe('open')
    expect(open.tauEnd).toBe(19_024n + (39_999n - 19_024n) / 10n)
    const timedOut = solvePaidCore(quiet, { untilWall: 40_000n })
    expect(timedOut.checkpoints[0]!.reason).toBe('timeout')
    expect(timedOut.panel).toBeNull()
    const recordedLater = solvePaidCore(withSlot(quiet, 1, slot(30n)), { untilWall: 29_999n })
    expect(recordedLater.panel?.checkpoint).toBe(1)
    const recordedNow = solvePaidCore(withSlot(quiet, 1, slot(30n)), { untilWall: 30_000n })
    expect(recordedNow.checkpoints[0]!.reason).toBe('forfeit-tx')
  })

  test('a slot for a checkpoint the player never reaches is ignored at the end of the race', () => {
    const profiles = fixtureProfiles()
    profiles[1] = { base: 0n, acceleration: 0n, cap: 0n }
    const input = fixtureInput({ profiles })
    const r = solvePaidCore(input, { trace: false })
    expect(r.checkpoints.map((c) => c.reason)).toEqual(['not-reached', 'not-reached', 'not-reached'])
    expect(solvePaidCore(input, { stopAtPanel: 1, trace: false }).panel).toBeNull()
    expect(ignoredChoice(withSlot(input, 1, slot(20n)), 1)).toEqual({ reason: INVALID_NOT_OPENED, equivalent: true })
    const r3 = solvePaidCore(withSlot(withSlot(input, 1, slot(20n)), 3, slot(90n, 7)), { trace: false })
    expect(r3.events.slice(-2).map((e) => [e.code, e.tau, e.arg])).toEqual([
      [EV_CHOICE_INVALID, 600_000n, 16n + 1n], [EV_CHOICE_INVALID, 600_000n, 48n + 1n],
    ])
    // A partial solve does not judge checkpoints it has not reached yet.
    expect(solvePaidCore(withSlot(input, 1, slot(20n)), { untilWall: 30_000n, trace: false }).checkpoints[0]!.invalidReason)
      .toBe(0)
  })

  test('a deferred checkpoint the player finishes before opening counts as not opened', () => {
    const profiles = fixtureProfiles()
    profiles[1] = { base: 30_000n, acceleration: 0n, cap: 30_000n }
    const input = fixtureInput({ profiles })
    const base = solvePaidCore(input, { trace: false })
    const three = base.checkpoints[2]!
    expect(three).toMatchObject({ reached: true, mode: null, reason: 'finished' })
    expect(ignoredChoice(withSlot(input, 3, slot(base.checkpoints[0]!.openSec + 5n)), 3))
      .toEqual({ reason: INVALID_NOT_OPENED, equivalent: true })
  })
})

describe('checkPaidChoice (pre-send check)', () => {
  test('accepts a choice inside an open manual panel and returns openSec', () => {
    expect(checkPaidChoice(withSlot(quiet, 1, slot(20n)), 1)).toBe(20n)
    expect(checkPaidChoice(withSlot(quiet, 1, slot(39n, 18)), 1)).toBe(20n)
    const second = withSlot(withSlot(quiet, 1, slot(25n)), 2, slot(45n, 19))
    expect(checkPaidChoice(second, 2)).toBe(solvePaidCore(second).checkpoints[1]!.openSec)
  })

  test('rejects early, late, out-of-order, missing, disabled and post-finish choices', () => {
    expect(() => checkPaidChoice(withSlot(quiet, 1, slot(19n)), 1)).toThrow('CHOICE_NOT_OPEN')
    expect(() => checkPaidChoice(withSlot(quiet, 1, slot(40n)), 1)).toThrow('CHOICE_OUTSIDE_WINDOW')
    expect(() => checkPaidChoice(withSlot(quiet, 1, slot(20n, 1)), 1)).toThrow('CARD_NOT_OFFERED')
    expect(() => checkPaidChoice(quiet, 1)).toThrow('CHOICE_MISSING')
    expect(() => checkPaidChoice(withSlot(withSlot(quiet, 1, slot(20n)), 2, slot(60n)), 1)).toThrow('CHOICE_ORDER')
    const cut = pickAt(fixtureInput({ playerDeck: [3, 17, 18, 21, 14, 15, 20, 19, 1, 2, 6, 7, 8, 10] }), 1, 3)
    const cutOpen = solvePaidCore(cut).checkpoints[1]!.openWall / 1000n + 1n
    expect(() => checkPaidChoice(withSlot(cut, 2, slot(cutOpen)), 2)).toThrow('CHOICE_NOT_OPEN')
    const profiles = fixtureProfiles()
    profiles[1] = { base: 14_000n, acceleration: 0n, cap: 14_000n }
    const fast = fixtureInput({ profiles })
    const third = solvePaidCore(fast).checkpoints[2]!
    expect(() => checkPaidChoice(withSlot(fast, 3, slot(third.openSec + 19n)), 3)).toThrow('CHOICE_AFTER_FINISH')
    expect(checkPaidChoice(withSlot(fast, 3, slot(third.openSec)), 3)).toBe(third.openSec)
  })
})

describe('classifyPaidChoice (post-receipt verdict)', () => {
  test('never throws for a rule-breaking choice and names the reason', () => {
    expect(classifyPaidChoice(withSlot(quiet, 1, slot(25n)), 1)).toEqual({ valid: true, openSec: 20n, reason: null })
    expect(classifyPaidChoice(withSlot(quiet, 1, slot(19n)), 1)).toEqual({ valid: false, openSec: 20n, reason: 'early' })
    expect(classifyPaidChoice(withSlot(quiet, 1, slot(40n)), 1)).toMatchObject({ valid: false, reason: 'late' })
    expect(classifyPaidChoice(withSlot(quiet, 1, slot(20n, 1)), 1)).toMatchObject({ valid: false, reason: 'not-offered' })
    expect(classifyPaidChoice(withSlot(quiet, 1, slot(20n, 200)), 1)).toMatchObject({ valid: false, reason: 'not-offered' })
    const cut = pickAt(fixtureInput({ playerDeck: [3, 17, 18, 21, 14, 15, 20, 19, 1, 2, 6, 7, 8, 10] }), 1, 3)
    expect(classifyPaidChoice(withSlot(cut, 2, slot(60n)), 2)).toEqual({ valid: false, openSec: 0n, reason: 'cut' })
    const profiles = fixtureProfiles()
    profiles[1] = { base: 14_000n, acceleration: 0n, cap: 14_000n }
    const fast = fixtureInput({ profiles })
    const third = solvePaidCore(fast).checkpoints[2]!
    expect(classifyPaidChoice(withSlot(fast, 3, slot(third.openSec + 19n)), 3)).toMatchObject({ reason: 'after-finish' })
    expect(() => classifyPaidChoice(quiet, 1)).toThrow('CHOICE_MISSING')
  })

  test('a later choice does not change the verdict of an earlier one', () => {
    const one = withSlot(quiet, 1, slot(19n))
    expect(classifyPaidChoice(withSlot(one, 2, slot(45n)), 1)).toEqual(classifyPaidChoice(one, 1))
  })
})

describe('input validation', () => {
  const bad = (patch: Partial<PaidCoreInput>) => ({ ...quiet, ...patch })
  test('malformed inputs and options throw', () => {
    expect(() => solvePaidCore(bad({ playerHorseId: 5 }))).toThrow('INVALID_HORSE')
    expect(() => solvePaidCore(bad({ profiles: quiet.profiles.slice(0, 4) }))).toThrow('INVALID_PROFILES')
    expect(() => solvePaidCore(bad({ profiles: [{ base: 2n, acceleration: 0n, cap: 1n }, ...quiet.profiles.slice(1)] })))
      .toThrow('INVALID_PROFILES')
    expect(() => solvePaidCore(bad({ playerDeck: [...quiet.playerDeck.slice(0, 13), quiet.playerDeck[0]!] }))).toThrow('INVALID_DECK')
    expect(() => solvePaidCore(bad({ playerDeck: [...quiet.playerDeck.slice(0, 13), 41] }))).toThrow('INVALID_DECK')
    expect(() => solvePaidCore(bad({ cpuDecks: [[1, 1, 2], ...quiet.cpuDecks.slice(1)] }))).toThrow('INVALID_CPU_DECKS')
    expect(() => solvePaidCore(bad({ cpuDecks: quiet.cpuDecks.slice(1) }))).toThrow('INVALID_CPU_DECKS')
    expect(() => solvePaidCore(bad({ seed: '0x12' }))).toThrow('INVALID_ANCHOR')
    // Representation only: stored values beyond uint8/uint32 cannot come from PonyGame.
    expect(() => solvePaidCore(withSlot(quiet, 1, { ...slot(20n), cardId: 256 }))).toThrow('INVALID_CHOICES')
    expect(() => solvePaidCore(withSlot(quiet, 1, { ...slot(20n), txSec: 1n << 32n }))).toThrow('INVALID_CHOICES')
    expect(() => solvePaidCore(withSlot(quiet, 1, { ...slot(20n), refreshSlots: [256] }))).toThrow('INVALID_CHOICES')
    expect(() => solvePaidCore(withSlot(quiet, 1, { ...slot(20n), refreshSlots: [0.5] }))).toThrow('INVALID_CHOICES')
    // Rule-breaking values are judged by the race instead.
    expect(ignoredChoice(withSlot(quiet, 1, { ...slot(20n), cardId: 27 }), 1)).toEqual({ reason: INVALID_NOT_OFFERED, equivalent: true })
    expect(ignoredChoice(withSlot(quiet, 1, slot(20n, 1)), 1)).toEqual({ reason: INVALID_NOT_OFFERED, equivalent: true })
    expect(() => solvePaidCore(quiet, { stopAtPanel: 4 as 1 })).toThrow('INVALID_OPTIONS')
    expect(() => solvePaidCore(quiet, { untilWall: -1n })).toThrow('INVALID_OPTIONS')
    // The player row of cpuDecks is ignored entirely.
    const ignored = bad({ cpuDecks: quiet.cpuDecks.map((d, h) => h === 1 ? [0, 99, 0] : d) })
    expect(solvePaidCore(ignored).digest).toBe(solvePaidCore(quiet).digest)
  })
})
