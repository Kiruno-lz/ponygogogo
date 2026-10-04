import { keccak256, toBytes } from 'viem'
import { chainEntropy } from '../race/core/chainEntropy.ts'
import type { RaceEvent, RaceInput, RaceState } from '../race/core/types.ts'
import { PAID_CARD_POOL } from '../race/cards/paidCards.ts'
import { EV_CARD } from '../race/paid/events.ts'
import { PURPOSE_WIND } from '../race/paid/constants.ts'
import { derivePaidCoreInput } from '../race/paid/race.ts'
import { solvePaidCore, type PaidChoiceSlot, type PaidCoreInput, type PaidPanelState, type PaidSolveResult } from '../race/paid/solver.ts'
import { tauAtWall } from '../race/paid/trace.ts'
import { buildPaidSnapshot, eventsUpTo, paidCardNumber, toRaceEvent, type PaidPanelView } from '../race/paidSnapshot.ts'
import type { RaceScreenDriver } from '../race/raceView.ts'
import { DEFAULT_ROSTER, normalizeRoster } from './ponyCatalog.ts'

export const EFFECT_SHOWCASE_SCENARIOS = PAID_CARD_POOL.map(card => card.cardId)
export type EffectShowcaseScenario = string
export type ShowcaseEntry = { playerHorseId: number; roster: readonly number[]; windDirection?: 1 | -1 }

/** Only fixture inputs live here. Every outcome, effect lifetime and event comes from the production solver. */
function showcaseInput(cardId: number, entry: ShowcaseEntry): PaidCoreInput {
  const sequence = cardId === 13 ? [19, 13]
    : cardId === 29 ? [19, 29]
      : cardId === 30 || cardId === 32 ? [7, cardId]
        : cardId === 37 || cardId === 38 ? [2, cardId]
          : cardId === 31 || cardId === 27 || cardId === 33 ? [cardId, 7]
            : cardId === 28 ? [28, 1]
              : cardId === 39 ? [39, 0] : [cardId]
  const seed = `0x${'02'.repeat(32)}` as const
  const input = derivePaidCoreInput({ seed, openAnchor: keccak256(toBytes('showcase.open')),
    stakeTier: 1, playerHorseId: entry.playerHorseId, roster: normalizeRoster(entry.roster), choices: [null, null, null] })
  const reserved = sequence.filter(id => id > 0)
  const fillers = [19, 20, ...PAID_CARD_POOL.map(card => Number(card.cardId.slice(2)))].filter((id, i, all) => !reserved.includes(id) && all.indexOf(id) === i)
  input.playerDeck = Array.from({ length: 14 }, (_, i) => i % 3 === 0 && sequence[i / 3] ? sequence[i / 3]! : fillers.shift()!)
  input.cpuDecks = input.cpuDecks.map((deck, h) => h === entry.playerHorseId ? deck : cardId === 13 ? [7, 14, 15] : [14, 15, 25])
  const choices: [PaidChoiceSlot | null, PaidChoiceSlot | null, PaidChoiceSlot | null] = [null, null, null]
  input.choices = choices
  for (let i = 0; i < sequence.length; i++) {
    const checkpoint = (i + 1) as 1 | 2 | 3
    const panel = solvePaidCore(input, { stopAtPanel: checkpoint, trace: false }).panel
    if (!panel || panel.mode !== 'manual') continue
    let anchor = keccak256(toBytes(`showcase.choice:${cardId}:${checkpoint}`))
    if (cardId === 12 && entry.windDirection) {
      for (let salt = 0; salt < 256; salt++) {
        anchor = keccak256(toBytes(`showcase.wind:${salt}`))
        const dir = chainEntropy(seed, anchor, checkpoint, PURPOSE_WIND, 0n) % 2n === 0n ? -1 : 1
        if (dir === entry.windDirection) break
      }
    }
    choices[i] = { txSec: panel.openSec + 1n, cardId: sequence[i]!, refreshSlots: [], anchor }
  }
  return input
}

/** A controllable clock over a real solved race; RaceScreen renders the same snapshots, HUD and card panels. */
export class EffectShowcaseDriver implements RaceScreenDriver {
  readonly countdownLeft = 0
  private readonly core: PaidCoreInput
  private readonly solved: PaidSolveResult
  private readonly startWall: number
  private readonly effectWall: number
  private wall: number
  private snapshot: RaceState
  private lastNow: number | null = null
  private paused = false
  private readonly emitted = new Set<string>()
  private readonly panels = new Map<number, PaidPanelState | null>()
  private feedback: RaceEvent[] = []

  constructor(readonly scenario: EffectShowcaseScenario, options: Partial<ShowcaseEntry> = {}) {
    const entry: ShowcaseEntry = { playerHorseId: 0, roster: DEFAULT_ROSTER, ...options }
    const cardId = paidCardNumber(scenario)
    if (cardId === null) throw new Error(`Unknown effect showcase card: ${scenario}`)
    this.core = showcaseInput(cardId, entry)
    this.solved = solvePaidCore(this.core)
    const event = this.solved.events.find(e => e.code === EV_CARD && e.horse === entry.playerHorseId && Number(e.arg) === cardId)
    if (!event) throw new Error(`Showcase card was not acquired: ${scenario}`)
    this.effectWall = Number(event.wall)
    this.startWall = Math.max(0, this.effectWall - 1_000)
    this.wall = this.startWall
    this.snapshot = this.sample()
  }

  get state(): RaceState { return this.snapshot }
  get replayInput(): PaidCoreInput { return this.core }
  canonicalResult(): PaidSolveResult { return this.solved }
  get elapsedWallMs(): number { return this.wall }
  get phase() { return this.snapshot.raceOver ? 'done' as const : 'racing' as const }
  get choiceLeftMs(): number {
    const rec = this.solved.checkpoints.find(c => c.reached && this.wall >= Number(c.openWall) && this.wall < Number(c.closeWall))
    return rec ? Number(rec.closeWall) - this.wall : -1
  }
  get slowmo(): boolean {
    const segment = this.solved.trace!.segments.filter(s => Number(s.wall) <= this.wall).at(-1)
    return segment?.slow ?? false
  }
  get choiceInteraction() {
    const rec = this.solved.checkpoints.find(c => c.reached && this.wall >= Number(c.openWall) && this.wall < Number(c.closeWall))
    return { locked: true, autoPick: rec ? rec.candidates.indexOf(rec.cardId) : null }
  }

  armChoiceDeadline(): void {}
  input(input: RaceInput): void {
    if (input.kind === 'gogoDown' && !this.snapshot.pending && !this.snapshot.playerFinished)
      this.feedback.push({ type: 'gogo', quality: 'good', tick: this.snapshot.tick })
  }

  update(nowMs: number): RaceEvent[] {
    const dt = this.lastNow === null ? 0 : Math.min(250, Math.max(0, nowMs - this.lastNow))
    this.lastNow = nowMs
    if (!this.paused) this.advance(dt)
    return this.feedback.splice(0)
  }
  pause(): void { this.paused = true }
  resume(): void { this.paused = false }
  step(milliseconds = 100): void { if (this.paused) this.advance(Math.max(1, milliseconds)) }
  restart(): void {
    this.wall = this.startWall
    this.lastNow = null
    this.paused = false
    this.emitted.clear()
    this.feedback = []
    this.snapshot = this.sample()
  }
  showEffect(): void { this.seek(this.effectWall) }
  nextEvent(): void {
    const event = this.solved.events.find(e => Number(e.wall) > this.wall && toRaceEvent(e, this.solved.trace!, this.core.playerHorseId, this.solved.finishTime) !== null)
    if (event) this.seek(Number(event.wall))
  }

  private seek(wall: number): void {
    this.wall = wall
    this.emitted.clear()
    this.feedback = []
    this.collectEvents(wall)
    this.snapshot = this.sample()
  }
  private advance(dt: number): void {
    this.wall = Math.min(Number(this.solved.wallEnd), this.wall + dt)
    this.collectEvents(this.startWall)
    this.snapshot = this.sample()
  }
  private collectEvents(floor: number): void {
    const trace = this.solved.trace!
    for (const event of eventsUpTo(trace.events, BigInt(Math.floor(this.wall)), this.emitted, BigInt(Math.floor(floor)))) {
      const translated = toRaceEvent(event, trace, this.core.playerHorseId, this.solved.finishTime)
      if (translated) this.feedback.push(translated)
    }
  }
  private sample(): RaceState {
    const trace = this.solved.trace!, wall = BigInt(Math.floor(this.wall)), tau = tauAtWall(trace, wall)
    let panel: PaidPanelView | null = null
    let draw = null
    for (const rec of this.solved.checkpoints) {
      if (!rec.reached || rec.mode === 'cut' || wall < rec.openWall || wall >= rec.closeWall) continue
      const k = rec.checkpoint as 1 | 2 | 3
      if (!this.panels.has(k)) this.panels.set(k, solvePaidCore(this.core, { stopAtPanel: k, trace: false }).panel)
      const info = this.panels.get(k)
      if (!info) continue
      draw = info.drawState
      panel = { checkpoint: k, mode: rec.mode!, candidates: rec.candidates, refreshSlots: [],
        refreshCredits: info.drawState.refreshCredits, openTau: rec.openTau }
      break
    }
    return buildPaidSnapshot({ trace, tau, roster: this.core.roster, playerHorseId: this.core.playerHorseId,
      stakeTier: 0, seed: this.core.seed, panel, draw, playerDeck: this.core.playerDeck,
      finishTime: this.solved.finishTime, raceOver: tau >= trace.tauEnd, versionAnswer: this.solved.versionAnswer })
  }
}
