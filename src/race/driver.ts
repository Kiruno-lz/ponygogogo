/** Local practice uses the paid solver; only its clock and random anchors are local. */
import { keccak256, padHex, toBytes, type Hex } from 'viem'
import type { RaceEvent, RaceInput, RaceResult, RaceState } from './core/types.ts'
import { derivePaidCoreInput } from './paid/race.ts'
import { checkPaidChoice, solvePaidCore, type PaidChoiceSlots, type PaidCoreInput, type PaidPanelState, type PaidSolveResult } from './paid/solver.ts'
import { tauAtWall } from './paid/trace.ts'
import { buildPaidSnapshot, eventsUpTo, idlePaidState, paidCardNumber, type PaidPanelView, toRaceEvent } from './paidSnapshot.ts'
import { paidRaceResult } from './paidResult.ts'
import { refreshPreview } from './paidWindow.ts'
import type { RaceScreenDriver } from './raceView.ts'

export interface DriverOptions { countdownMs: number; tailSpeed: number }
export const DEFAULT_DRIVER: DriverOptions = { countdownMs: 3000, tailSpeed: 6 }
export type DriverPhase = 'countdown' | 'racing' | 'tail' | 'done'
export interface PracticeConfig { seed: string; playerHorseId: number; stakeTier: number }

function urlRaceSpeed(): number {
  if (typeof window === 'undefined') return 1
  const v = Number(new URLSearchParams(window.location.search).get('raceSpeed'))
  return Number.isFinite(v) && v >= 1 && v <= 40 ? v : 1
}

export class RaceDriver implements RaceScreenDriver {
  raceId = 'local'
  phase: DriverPhase = 'countdown'
  countdownLeft: number
  choiceLeftMs = -1
  private readonly core: PaidCoreInput
  private choices: PaidChoiceSlots = [null, null, null]
  private solved: PaidSolveResult
  private snapshot: RaceState
  private wall = 0
  private lastNow = -1
  private readonly speed = urlRaceSpeed()
  private readonly emitted = new Set<string>()
  private readonly panelCache = new Map<number, PaidPanelState | null>()
  private info: PaidPanelState | null = null
  private refreshSlots: number[] = []
  private queuedPick: { checkpoint: number; cardId: number; slots: number[]; txSec: bigint } | null = null
  private feedback: RaceEvent[] = []
  private autoPick: number | null = null
  private slow = false

  constructor(cfg: PracticeConfig, private readonly opts: DriverOptions = DEFAULT_DRIVER) {
    if (cfg.stakeTier !== 0) throw new Error('PRACTICE_TIER_REQUIRED')
    const seed = padHex(cfg.seed as Hex, { size: 32 })
    this.core = derivePaidCoreInput({
      seed, openAnchor: keccak256(toBytes(`practice.open:${seed}`)), playerHorseId: cfg.playerHorseId,
      stakeTier: 1, choices: this.choices,
    })
    this.solved = solvePaidCore(this.core)
    this.snapshot = idlePaidState(cfg.playerHorseId, 0)
    this.countdownLeft = opts.countdownMs / this.speed
  }

  get state(): RaceState { return this.snapshot }
  get elapsedWallMs(): number { return this.wall }
  get slowmo(): boolean { return this.slow }
  get choiceInteraction() { return { locked: this.queuedPick !== null, autoPick: this.autoPick } }
  /** Frozen local anchors and recorded choices allow exact replay through the shared solver. */
  get replayInput(): PaidCoreInput { return { ...this.core, choices: this.choices } }
  canonicalResult(): PaidSolveResult { return this.solved }
  buildResult(raceId: string): RaceResult {
    return paidRaceResult(raceId, this.core.seed, this.core.playerHorseId, this.solved)
  }
  armChoiceDeadline(): void {} // The shared rule timeline defines the window, independently of animation.

  input(i: RaceInput): void {
    if (i.kind === 'gogoDown') {
      if (this.phase === 'racing' && !this.snapshot.pending) this.feedback.push({ type: 'gogo', quality: 'good', tick: this.snapshot.tick })
      return
    }
    const info = this.info
    if (!info || info.mode !== 'manual' || this.queuedPick || !this.snapshot.pending) return
    const view = refreshPreview(this.core.playerDeck, info.drawState, this.refreshSlots)
    if (i.kind === 'refresh') {
      if (view.canRefresh[i.slot]) this.refreshSlots.push(i.slot)
      return
    }
    if (i.kind !== 'pick') return
    const cardId = i.cardId === null ? 0 : paidCardNumber(i.cardId)
    if (cardId === null || (cardId !== 0 && !view.candidates.includes(cardId))) return
    const txSec = BigInt(Math.max(Number(info.openSec), Math.ceil(this.wall / 1000)))
    const slots = cardId === 0 ? [] : [...this.refreshSlots]
    const choice = { txSec, cardId, refreshSlots: slots, anchor: this.choiceAnchor(info.checkpoint, txSec) }
    const choices = [...this.choices] as [typeof choice | null, typeof choice | null, typeof choice | null]
    choices[info.checkpoint - 1] = choice
    try { checkPaidChoice({ ...this.core, choices }, info.checkpoint as 1 | 2 | 3) }
    catch { return }
    this.queuedPick = { checkpoint: info.checkpoint, cardId, slots, txSec }
  }

  private choiceAnchor(k: number, sec: bigint): Hex {
    return keccak256(toBytes(`practice.choice:${this.core.seed}:${k}:${sec}`))
  }

  update(nowMs: number): RaceEvent[] {
    if (this.lastNow < 0) this.lastNow = nowMs
    const dt = Math.min(250, Math.max(0, nowMs - this.lastNow))
    this.lastNow = nowMs
    if (this.phase === 'countdown') {
      this.countdownLeft = Math.max(0, this.countdownLeft - dt)
      if (this.countdownLeft === 0) this.phase = 'racing'
      return []
    }
    if (this.phase === 'done') return []
    // Debug fast-forward does not shorten the real-time card window; stop exactly at its opening.
    let next = this.wall + dt * (this.slow ? 1 : this.speed * (this.phase === 'tail' ? this.opts.tailSpeed : 1))
    const opening = this.solved.checkpoints.find((c) => c.reached && c.mode !== 'cut' && Number(c.openWall) > this.wall && Number(c.openWall) <= next)
    if (opening) next = Number(opening.openWall)
    this.wall = next
    const pick = this.queuedPick
    if (pick && this.wall >= Number(pick.txSec) * 1000) {
      const choices = [...this.choices] as [typeof this.choices[0], typeof this.choices[1], typeof this.choices[2]]
      choices[pick.checkpoint - 1] = {
        txSec: pick.txSec, cardId: pick.cardId, refreshSlots: pick.slots,
        anchor: this.choiceAnchor(pick.checkpoint, pick.txSec),
      }
      this.choices = choices
      this.solved = solvePaidCore(this.replayInput)
      this.panelCache.clear()
      this.queuedPick = null
      this.refreshSlots = []
    }
    const trace = this.solved.trace!
    const wall = BigInt(Math.floor(this.wall))
    const tau = tauAtWall(trace, wall)
    let segment = trace.segments[0]!
    for (const s of trace.segments) { if (s.wall > wall) break; segment = s }
    this.slow = segment.slow
    this.info = null
    this.autoPick = null
    this.choiceLeftMs = -1
    let panel: PaidPanelView | null = null
    for (const rec of this.solved.checkpoints) {
      if (!rec.reached || (rec.mode !== 'manual' && rec.mode !== 'auto') || wall < rec.openWall || wall >= rec.closeWall) continue
      if (!this.panelCache.has(rec.checkpoint)) this.panelCache.set(rec.checkpoint,
        solvePaidCore(this.replayInput, { stopAtPanel: rec.checkpoint as 1 | 2 | 3, trace: false }).panel)
      const info = this.panelCache.get(rec.checkpoint)
      if (!info) continue
      this.info = info
      this.choiceLeftMs = Math.max(0, Number(rec.mode === 'auto' ? rec.closeWall : rec.deadlineSec * 1000n) - this.wall)
      if (this.queuedPick) break
      const slots = rec.mode === 'auto' ? [] : this.refreshSlots
      const view = refreshPreview(this.core.playerDeck, info.drawState, slots)
      panel = { checkpoint: rec.checkpoint as 1 | 2 | 3, mode: rec.mode, candidates: view.candidates,
        refreshSlots: [...slots], refreshCredits: view.canRefresh.some(Boolean) ? view.creditsLeft : 0, openTau: info.openTau }
      if (rec.mode === 'auto') this.autoPick = view.candidates.indexOf(rec.cardId)
      break
    }
    const events = this.feedback
    this.feedback = []
    for (const e of eventsUpTo(trace.events, wall, this.emitted, 0n)) {
      const event = toRaceEvent(e, trace, this.core.playerHorseId, this.solved.finishTime)
      if (event) events.push(event)
    }
    const raceOver = tau >= trace.tauEnd
    this.snapshot = buildPaidSnapshot({ trace, tau, playerHorseId: this.core.playerHorseId, stakeTier: 0,
      seed: this.core.seed, panel, draw: this.info?.drawState ?? null, playerDeck: this.core.playerDeck,
      finishTime: this.solved.finishTime, raceOver, versionAnswer: this.solved.versionAnswer })
    this.phase = raceOver ? 'done' : this.snapshot.playerFinished ? 'tail' : 'racing'
    return events
  }
}
