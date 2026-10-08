/** Payout planner used for paired role balance experiments through the current production solver. */
import { keccak256, toBytes, type Hex } from 'viem'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import { solvePaidCore, type PaidCoreInput, type PaidPanelState, type PaidSolveResult, type PaidChoiceSlot } from '../src/race/paid/solver.ts'
import { classifyPaidDraw } from '../src/race/core/paidDrawRules.ts'
import { PONY_RULES, type PonyRule } from '../src/race/paid/ponyRules.ts'
import { EV_DEATH, EV_EXHAUST_ENTER } from '../src/race/paid/events.ts'
import { strategyPayoutBps } from './analyze-pony-strategies.ts'

export const H = (s: string): Hex => keccak256(toBytes(`claude-balance/v1/${s}`))

/** Experimental control only: ponies 9..13 have an ability that is a no-op for CPU horses. */
export const NULL_PONIES = [9, 10, 11, 12, 13]
let nullsInstalled = false
export function installNullPonies() {
  if (nullsInstalled) return
  for (const id of NULL_PONIES) (PONY_RULES as PonyRule[]).push({ id, enabled: true, ability: 'refresh', refreshCount: 0 })
  nullsInstalled = true
}

export type Ctx = { label: string; tier: 1 | 2 | 3 | 4; pony: number; roster: number[]; slot: number }
export function makeCore(c: Ctx): PaidCoreInput {
  return derivePaidCoreInput({ seed: H(`${c.label}/seed`), openAnchor: H(`${c.label}/open`), stakeTier: c.tier,
    playerHorseId: c.slot, roster: c.roster, choices: [null, null, null] })
}
export function rosterWith(pony: number, opponents: number[], slot: number): number[] {
  const r = [...opponents]; r.splice(slot, 0, pony); return r
}

export type Action = { cardId: number; refreshSlots: number[] }
export const RANDOM_CARDS = new Set([4, 9, 12, 13])

export function withChoice(input: PaidCoreInput, panel: PaidPanelState, a: Action, anchor: Hex, delay = 1n): PaidCoreInput {
  const choices = [...input.choices] as [PaidChoiceSlot | null, PaidChoiceSlot | null, PaidChoiceSlot | null]
  choices[panel.checkpoint - 1] = { txSec: panel.openSec + delay, cardId: a.cardId, refreshSlots: a.refreshSlots, anchor }
  return { ...input, choices }
}

/** Rational actions: pick an offered card, forfeit, or spend j refreshes to reach tail card T_j. */
export function legalActions(input: PaidCoreInput, panel: PaidPanelState): Action[] {
  const out: Action[] = []
  const ds = panel.drawState
  for (const c of [...panel.candidates, 0]) if (classifyPaidDraw(input.playerDeck, ds, [], c) === 0) out.push({ cardId: c, refreshSlots: [] })
  for (let j = 1; j <= Math.min(3, ds.refreshCredits); j++) {
    const slots = [0, 1, 2].slice(0, j)
    const card = input.playerDeck[ds.tailCursor - j]
    if (card === undefined) break
    if (classifyPaidDraw(input.playerDeck, ds, slots, card) === 0) out.push({ cardId: card, refreshSlots: slots })
  }
  return out
}

export const finishMs = (r: PaidSolveResult, h: number) => Number(r.finishTime[h]!)

export const PAY = [0, ...strategyPayoutBps().map(bps => bps / 10000)]
export type Objective = 'time' | 'payout'
export type Val = { cost: number; finish: number; pay: number; win: number }
const valOf = (r: PaidSolveResult, h: number, obj: Objective): Val => {
  const finish = finishMs(r, h), pay = PAY[r.settlementRank]!, win = r.settlementRank === 1 ? 1 : 0
  return { cost: obj === 'time' ? finish : -pay * 1e7 + finish, finish, pay, win }
}
const mean = (vs: Val[]): Val => ({ cost: vs.reduce((a, v) => a + v.cost, 0) / vs.length, finish: vs.reduce((a, v) => a + v.finish, 0) / vs.length,
  pay: vs.reduce((a, v) => a + v.pay, 0) / vs.length, win: vs.reduce((a, v) => a + v.win, 0) / vs.length })
export type Plan = { value: Val; first: Action | null; q: { a: Action; v: Val }[] }

/**
 * Expert planner: knows the public deck, re-plans every checkpoint, minimises expected cost (own finish time, or
 * payout-first with finish tie-break). Random-card choices average `samples` forecast anchors; others use one anchor.
 * horizon < 3 = later panels time out in forecasts (myopic).
 */
export function plan(input: PaidCoreInput, k: number, domain: string, obj: Objective, samples = 3, horizon = 3): Plan {
  const h = input.playerHorseId
  if (k > horizon) return { value: valOf(solvePaidCore(input, { trace: false }), h, obj), first: null, q: [] }
  const stop = solvePaidCore(input, { stopAtPanel: k as 1 | 2 | 3, trace: false })
  if (stop.status !== 'panel' || !stop.panel) return { value: valOf(stop.status === 'complete' ? stop : solvePaidCore(input, { trace: false }), h, obj), first: null, q: [] }
  if (stop.panel.mode !== 'manual') return { value: plan(input, k + 1, domain, obj, samples, horizon).value, first: null, q: [] }
  const q: { a: Action; v: Val }[] = []
  for (const a of legalActions(input, stop.panel)) {
    const n = RANDOM_CARDS.has(a.cardId) ? samples : 1
    const vs: Val[] = []
    for (let s = 0; s < n; s++) vs.push(plan(withChoice(input, stop.panel, a, H(`${domain}/fc/${input.seed}/${k}/${s}`)), k + 1, domain, obj, samples, horizon).value)
    q.push({ a, v: mean(vs) })
  }
  q.sort((x, y) => x.v.cost - y.v.cost || x.a.refreshSlots.length - y.a.refreshSlots.length)
  return { value: q[0]!.v, first: q[0]!.a, q }
}

export type Decision = { k: number; offer: number[]; tail: number[]; credits: number; q: { card: number; refresh: number; finish: number; pay: number; win: number }[]; chosen: Action }
export type Policy = 'expert' | 'myopic' | 'timeout' | 'forfeit' | 'first'

/** Plays the race with a policy; execution anchors differ from forecast anchors. */
export function play(core: PaidCoreInput, policy: Policy, obj: Objective = 'payout', domain = 'p'): { input: PaidCoreInput; result: PaidSolveResult; decisions: Decision[] } {
  let cur = core
  const decisions: Decision[] = []
  for (const k of [1, 2, 3] as const) {
    if (policy === 'timeout') break
    const stop = solvePaidCore(cur, { stopAtPanel: k, trace: false })
    if (stop.status !== 'panel' || !stop.panel || stop.panel.mode !== 'manual') continue
    const panel = stop.panel
    let chosen: Action
    let q: Plan['q'] = []
    if (policy === 'forfeit') chosen = { cardId: 0, refreshSlots: [] }
    else if (policy === 'first') chosen = { cardId: panel.candidates[0]!, refreshSlots: [] }
    else {
      const p = plan(cur, k, domain, obj, 3, policy === 'expert' ? 3 : k)
      chosen = p.first!; q = p.q
    }
    const ds = panel.drawState
    decisions.push({ k, offer: [...panel.candidates], tail: [1, 2, 3].map(j => core.playerDeck[ds.tailCursor - j] ?? 0),
      credits: ds.refreshCredits, q: q.map(x => ({ card: x.a.cardId, refresh: x.a.refreshSlots.length, finish: x.v.finish, pay: x.v.pay, win: x.v.win })), chosen })
    cur = withChoice(cur, panel, chosen, H(`${domain}/exec/${core.seed}/${k}`))
  }
  return { input: cur, result: solvePaidCore(cur, { trace: false }), decisions }
}

export function summarize(r: PaidSolveResult, h: number) {
  return {
    finish: finishMs(r, h), rank: r.rawRank, srank: r.settlementRank, version: r.versionAnswer,
    acquired: r.acquiredByCheckpoint, cpu: r.finishTime.map(Number),
    exhaust: r.events.filter(e => e.horse === h && e.code === EV_EXHAUST_ENTER).length,
    deaths: r.events.filter(e => e.horse === h && e.code === EV_DEATH).length,
    modes: r.checkpoints.map(c => c.mode ?? c.reason),
  }
}
