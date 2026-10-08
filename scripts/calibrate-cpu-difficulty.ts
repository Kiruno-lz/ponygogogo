/**
 * CPU difficulty calibration (docs/plan/numerical-balance.md §1.3): return-to-player of random, myopic and expert play
 * for CPU speed-cap offset ranges. Opponents are neutral roles registered in this process only (no CPU effect), i.e.
 * the most favourable roster; results are an upper bound. Shards append JSONL; `--summary` aggregates a directory.
 *
 *   bun --no-env-file scripts/calibrate-cpu-difficulty.ts --ranges 100:500 --n 300 --shard 0/8
 *   bun --no-env-file scripts/calibrate-cpu-difficulty.ts --summary
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { keccak256, toBytes, type Hex } from 'viem'
import { classifyPaidDraw } from '../src/race/core/paidDrawRules.ts'
import { PLAYER_BALANCE } from '../src/race/paid/playerBalance.ts'
import { PONY_RULES, type PonyRule } from '../src/race/paid/ponyRules.ts'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import {
  solvePaidCore, type PaidChoiceSlot, type PaidCoreInput, type PaidPanelState, type PaidSolveResult,
} from '../src/race/paid/solver.ts'

const PAY = [0, 3, 1.5, 1, 0, 0]
const RANDOM_CARDS = new Set([4, 9, 12, 13])
const NEUTRAL = [9, 10, 11, 12, 13]
const H = (s: string): Hex => keccak256(toBytes(`cpu-difficulty/v1/${s}`))
const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? d : process.argv[i + 1]! }

type Action = { cardId: number; refreshSlots: number[] }
type Val = { cost: number; finish: number }
export type Policy = 'random' | 'myopic' | 'expert'

/** Refresh credits of 0 make the role a no-op for CPU horses and for the player. */
function registerNeutralRoles() {
  for (const id of NEUTRAL) {
    if (!PONY_RULES.some(r => r.id === id)) (PONY_RULES as PonyRule[]).push({ id, enabled: true, ability: 'refresh', refreshCount: 0 })
  }
}

/** Test cleanup: drops the neutral roles so other suites in the same process see the canonical table. */
export function unregisterNeutralRoles() {
  const rules = PONY_RULES as PonyRule[]
  for (let i = rules.length - 1; i >= 0; i--) if (NEUTRAL.includes(rules[i]!.id)) rules.splice(i, 1)
}

function withChoice(input: PaidCoreInput, panel: PaidPanelState, a: Action, anchor: Hex): PaidCoreInput {
  const choices = [...input.choices] as [PaidChoiceSlot | null, PaidChoiceSlot | null, PaidChoiceSlot | null]
  choices[panel.checkpoint - 1] = { txSec: panel.openSec + 1n, cardId: a.cardId, refreshSlots: a.refreshSlots, anchor }
  return { ...input, choices }
}

/** Offered cards, active forfeit, or j refreshes spent to take tail card T_j. */
function legalActions(input: PaidCoreInput, panel: PaidPanelState): Action[] {
  const out: Action[] = []
  const ds = panel.drawState
  for (const c of [...panel.candidates, 0]) if (classifyPaidDraw(input.playerDeck, ds, [], c) === 0) out.push({ cardId: c, refreshSlots: [] })
  for (let j = 1; j <= Math.min(3, ds.refreshCredits); j++) {
    const slots = [0, 1, 2].slice(0, j), card = input.playerDeck[ds.tailCursor - j]
    if (card !== undefined && classifyPaidDraw(input.playerDeck, ds, slots, card) === 0) out.push({ cardId: card, refreshSlots: slots })
  }
  return out
}

function value(r: PaidSolveResult, h: number): Val {
  const finish = Number(r.finishTime[h]!)
  return { cost: -PAY[r.settlementRank]! * 1e7 + finish, finish }
}

/** Expected-payout planner over the public deck; random cards average three forecast anchors. */
function plan(input: PaidCoreInput, k: number, horizon: number): { v: Val; first: Action | null } {
  const h = input.playerHorseId
  if (k > horizon) return { v: value(solvePaidCore(input, { trace: false }), h), first: null }
  const stop = solvePaidCore(input, { stopAtPanel: k as 1 | 2 | 3, trace: false })
  if (stop.status !== 'panel' || !stop.panel) return { v: value(stop.status === 'complete' ? stop : solvePaidCore(input, { trace: false }), h), first: null }
  if (stop.panel.mode !== 'manual') return { v: plan(input, k + 1, horizon).v, first: null }
  let best: { v: Val; first: Action } | null = null
  for (const a of legalActions(input, stop.panel)) {
    const n = RANDOM_CARDS.has(a.cardId) ? 3 : 1
    let cost = 0, finish = 0
    for (let s = 0; s < n; s++) {
      const v = plan(withChoice(input, stop.panel, a, H(`forecast/${input.seed}/${k}/${s}`)), k + 1, horizon).v
      cost += v.cost / n; finish += v.finish / n
    }
    if (!best || cost < best.v.cost || (cost === best.v.cost && a.refreshSlots.length < best.first.refreshSlots.length)) best = { v: { cost, finish }, first: a }
  }
  return best!
}

export function playRace(core: PaidCoreInput, policy: Policy): PaidSolveResult {
  let cur = core
  for (const k of [1, 2, 3] as const) {
    const stop = solvePaidCore(cur, { stopAtPanel: k, trace: false })
    if (stop.status !== 'panel' || !stop.panel || stop.panel.mode !== 'manual') continue
    const action = policy === 'random'
      ? { cardId: stop.panel.candidates[Number(BigInt(H(`random/${core.seed}/${k}`)) % 3n)]!, refreshSlots: [] }
      : plan(cur, k, policy === 'expert' ? 3 : k).first!
    cur = withChoice(cur, stop.panel, action, H(`execute/${core.seed}/${k}`))
  }
  return solvePaidCore(cur, { trace: false })
}

/** Production derivation with the offset range overridden in this process. */
export function raceInput(label: string, n: number, pony: number, lo: number, hi: number): PaidCoreInput {
  registerNeutralRoles()
  const balance = PLAYER_BALANCE as { cpuCapOffsetMin: number; cpuCapOffsetMax: number }
  balance.cpuCapOffsetMin = lo; balance.cpuCapOffsetMax = hi
  const slot = n % 5, roster = NEUTRAL.slice(1); roster.splice(slot, 0, pony)
  return derivePaidCoreInput({ seed: H(`${label}/${n}/seed`), openAnchor: H(`${label}/${n}/open`), stakeTier: 1,
    playerHorseId: slot, roster, choices: [null, null, null] })
}

function summary(dir: string) {
  const rows = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    .flatMap(f => readFileSync(resolve(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)))
  const groups = new Map<string, typeof rows>()
  for (const r of rows) groups.set(`${r.lo}:${r.hi}`, [...(groups.get(`${r.lo}:${r.hi}`) ?? []), r])
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  for (const [range, rs] of groups) {
    const policies = Object.keys(rs[0].rank) as Policy[]
    const perPony = [...new Set(rs.map(r => r.pony))].sort().map(p => mean(rs.filter(r => r.pony === p).map(r => PAY[r.rank.expert] ?? NaN)))
    console.log(`[${range}] n=${rs.length} ` + policies.map(p => `${p} RTP ${mean(rs.map(r => PAY[r.rank[p]]!)).toFixed(3)}`).join(' | ')
      + (policies.includes('expert') ? ` | expert per pony ${perPony.map(x => x.toFixed(2)).join('/')}` : ''))
  }
}

if (import.meta.main) {
  const out = resolve(arg('out', '.cache/cpu-difficulty'))
  if (process.argv.includes('--summary')) summary(out)
  else {
    const n = Number(arg('n', '300')), label = arg('label', 'calibration')
    const ranges = arg('ranges', `${PLAYER_BALANCE.cpuCapOffsetMin}:${PLAYER_BALANCE.cpuCapOffsetMax}`).split(',').map(r => r.split(':').map(Number) as [number, number])
    const ponies = arg('ponies', '0,1,2,3,4,5,6,7,8').split(',').map(Number)
    const policies = arg('policies', 'random,myopic,expert').split(',') as Policy[]
    const [idx, of] = arg('shard', '0/1').split('/').map(Number) as [number, number]
    mkdirSync(out, { recursive: true })
    let job = 0
    for (let i = 0; i < n; i++) for (const pony of ponies) for (const [lo, hi] of ranges) {
      if ((job++) % of !== idx) continue
      const core = raceInput(label, i, pony, lo, hi)
      const rank = Object.fromEntries(policies.map(p => [p, playRace(core, p).settlementRank]))
      appendFileSync(resolve(out, `shard-${idx}.jsonl`), JSON.stringify({ n: i, pony, lo, hi, caps: core.profiles.map(p => Number(p.cap)), rank }) + '\n')
    }
  }
}
