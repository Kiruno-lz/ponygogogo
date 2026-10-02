import { FP } from '../race/core/fixed.ts'
import { RaceDriver as LocalRaceDriver } from '../race/driver.ts'
import { CARD_BY_ID, CARD_POOL } from '../race/cards/pool.ts'
import type { AbilityId, EffectInstance, RaceEvent, RaceInput, RaceState } from '../race/core/types.ts'
import type { DriverPhase } from '../race/driver.ts'
import type { RaceScreenDriver } from '../race/raceView.ts'

export const EFFECT_SHOWCASE_SCENARIOS = CARD_POOL.map((card) => card.cardId)
export type EffectShowcaseScenario = (typeof EFFECT_SHOWCASE_SCENARIOS)[number]

const EVENT_AT_MS = 1_000
const SPIN_DURATION_MS = 6_000

function createBaseState(): RaceState {
  const seed = `0x${'02'.repeat(32)}`
  return structuredClone(new LocalRaceDriver({ seed, playerHorseId: 0, stakeTier: 0 }, { countdownMs: 0, tailSpeed: 1 }).state)
}

function createInstance(
  cardId: string,
  declaration: (typeof CARD_POOL)[number]['effects'][number],
  instanceId: number,
  ownerHorseId: number,
): EffectInstance {
  const payload = { ...declaration.payload }
  if (cardId === 'C-12' && payload.envKind === 'wind') payload.windDir = 1
  return {
    instanceId,
    sourceCardId: cardId,
    primitive: declaration.primitive,
    moduleId: declaration.moduleId,
    ownerHorseId: declaration.primitive === 'Environment' ? -1 : ownerHorseId,
    appliedAtTick: 0,
    durationTicks: cardId === 'C-02' && declaration.durationTicks !== null
      ? Math.ceil(SPIN_DURATION_MS / 20)
      : declaration.durationTicks,
    tags: [...declaration.tags],
    payload,
  }
}

function buildEffects(cardId: EffectShowcaseScenario, elapsedMs: number): EffectInstance[] {
  if (cardId === 'C-02' && elapsedMs >= SPIN_DURATION_MS) return []
  const card = CARD_BY_ID[cardId]!
  const effects = card.effects.map((declaration, index) =>
    createInstance(cardId, declaration, index + 1, 0))

  if (cardId === 'C-13') {
    const stolenRocket = CARD_BY_ID['C-07']!.effects.find((effect) => effect.payload.equipId === 'rocket')!
    effects.push(createInstance('C-07', stolenRocket, effects.length + 1, elapsedMs < EVENT_AT_MS ? 1 : 0))
  }

  if (cardId === 'C-11') {
    const id = effects.length + 1
    effects.push({
      instanceId: id, sourceCardId: cardId, primitive: 'Status', moduleId: 'mod.airborne', ownerHorseId: 0,
      appliedAtTick: 0, durationTicks: 1_500, tags: ['buff'], payload: { statusId: 'airborne' },
    })
    effects.push({
      instanceId: id + 1, sourceCardId: cardId, primitive: 'Modifier', moduleId: 'mod.speed', ownerHorseId: 0,
      appliedAtTick: 0, durationTicks: 1_500, tags: ['buff'],
      payload: { modifiers: [{ target: 'speed', op: 'padd', pool: 'b1', value: 4_000 }] },
    })
    effects.push({
      instanceId: id + 2, sourceCardId: cardId, primitive: 'Status', moduleId: 'mod.stack', ownerHorseId: 0,
      appliedAtTick: 0, durationTicks: 1_500, tags: ['debuff'],
      payload: { statusId: 'burning', stacks: Math.min(6, Math.floor(elapsedMs / 1_000)) },
    })
  }

  return effects
}

function abilityFor(effects: readonly EffectInstance[]): AbilityId | null {
  const ability = effects.find((effect) => effect.primitive === 'Ability')?.payload.abilityId
  return ability === 'clapSwap' || ability === 'wheelHold' ? ability : null
}

function playerSpeedFactor(effects: readonly EffectInstance[]): number {
  let factor = 1
  for (const effect of effects) {
    if (effect.ownerHorseId !== 0 || !Array.isArray(effect.payload.modifiers)) continue
    for (const modifier of effect.payload.modifiers) {
      if (modifier.target !== 'speed') continue
      if (modifier.op === 'padd') factor += Number(modifier.value) / FP
      else if (modifier.op === 'add') factor += Number(modifier.value) / (35 * FP)
    }
  }
  return factor
}

/** 固定五马轨迹，只把每张正式可玩卡的数据与预设事件送入生产表现层。 */
export class EffectShowcaseDriver implements RaceScreenDriver {
  readonly phase: DriverPhase = 'racing'
  readonly countdownLeft = 0
  readonly choiceLeftMs = -1
  readonly slowmo = false
  private readonly baseState = createBaseState()
  private currentState: RaceState = structuredClone(this.baseState)
  private startedAt: number | null = null
  private lastNow: number | null = null
  private frozenElapsed = 0
  private paused = false
  private eventSent = false
  private pendingEvents: RaceEvent[] = []
  private windDirection: 1 | -1 = 1

  constructor(readonly scenario: EffectShowcaseScenario) {
    if (!CARD_BY_ID[scenario]) throw new Error(`Unknown effect showcase card: ${scenario}`)
    this.updateState(0)
  }

  get state(): RaceState {
    return this.currentState
  }

  setWindDirection(direction: 1 | -1): void {
    this.windDirection = direction
    if (this.currentState.env?.payload.envKind === 'wind') this.currentState.env.payload.windDir = direction
  }

  update(nowMs: number): RaceEvent[] {
    if (this.startedAt === null) this.startedAt = nowMs - this.frozenElapsed
    this.lastNow = nowMs
    if (this.paused) return this.pendingEvents.splice(0)
    const elapsedMs = Math.max(0, nowMs - this.startedAt)
    this.updateState(elapsedMs)
    return [...this.pendingEvents.splice(0), ...this.takeScheduledEvent(elapsedMs)]
  }

  input(_input: RaceInput): void {}

  armChoiceDeadline(): void {}

  pause(): void {
    if (this.paused) return
    this.paused = true
    if (this.startedAt !== null && this.lastNow !== null) this.frozenElapsed = Math.max(0, this.lastNow - this.startedAt)
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.startedAt = this.lastNow === null ? null : this.lastNow - this.frozenElapsed
  }

  step(milliseconds = 100): void {
    if (!this.paused) return
    this.frozenElapsed += Math.max(1, milliseconds)
    this.updateState(this.frozenElapsed)
    const event = this.takeScheduledEvent(this.frozenElapsed)
    if (event.length > 0) this.pendingEvents.push(...event)
  }

  restart(): void {
    this.startedAt = null
    this.lastNow = null
    this.frozenElapsed = 0
    this.paused = false
    this.eventSent = false
    this.pendingEvents = []
    this.updateState(0)
  }

  private takeScheduledEvent(elapsedMs: number): RaceEvent[] {
    if (this.eventSent || elapsedMs < EVENT_AT_MS) return []
    this.eventSent = true
    if (this.scenario === 'C-09') return [{ type: 'swap', a: 0, b: 1, tick: Math.floor(elapsedMs / 20) }]
    if (this.scenario === 'C-13') return [{ type: 'steal', from: 1, to: 0, equipId: 'rocket', tick: Math.floor(elapsedMs / 20) }]
    return []
  }

  private updateState(elapsedMs: number): void {
    const state = structuredClone(this.baseState)
    state.tick = Math.floor(elapsedMs / 20)
    state.effects = buildEffects(this.scenario, elapsedMs)
    state.nextInstanceId = state.effects.length + 1
    state.env = state.effects.find((effect) => effect.primitive === 'Environment') ?? null
    if (state.env?.payload.envKind === 'wind') state.env.payload.windDir = this.windDirection

    const ability = abilityFor(state.effects)
    state.abilityBinding = ability ? { abilityId: ability, instanceId: state.nextInstanceId, ownerHorseId: 0 } : null
    state.abilityHeld = ability === 'wheelHold'

    const drawRule = state.effects.find((effect) => effect.primitive === 'DrawRule')?.payload.drawRule
    state.drawMode = drawRule === 'auto' || drawRule === 'cut' ? drawRule : 'manual'
    state.refreshCredits = this.scenario === 'C-05' ? 1 : 0
    if (this.scenario === 'C-04') state.drawBonusPct = 2_000

    for (const horse of state.horses) {
      const speedFactor = horse.horseId === 0 ? playerSpeedFactor(state.effects) : 1
      const progress = elapsedMs * (0.018 + horse.horseId * 0.001) * speedFactor
      horse.pos = Math.round((horse.horseId * 105 + progress) * FP)
      horse.dist = horse.pos
      horse.v = Math.round(35 * FP * speedFactor)
    }

    if (this.scenario === 'C-06') {
      const pos = state.horses[0]!.pos + 260 * FP
      state.hazards = state.horses.filter((horse) => horse.horseId !== 0).map((horse, index) => ({
        hazardId: index + 1, laneIndex: horse.laneIndex, pos, sourceCardId: 'C-06',
      }))
    }
    if (this.scenario === 'C-14') {
      state.horses[0]!.stamina = Math.min(1_000 * FP, 500 * FP + Math.floor(elapsedMs * 0.05 * FP))
    }
    if (this.scenario === 'C-15') state.horses[0]!.stamina = 1_200 * FP

    if (this.scenario === 'C-09' && elapsedMs >= EVENT_AT_MS) {
      const a = state.horses[0]!
      const b = state.horses[1]!
      ;[a.laneIndex, b.laneIndex] = [b.laneIndex, a.laneIndex]
      ;[a.pos, b.pos] = [b.pos, a.pos]
    }
    this.currentState = state
  }
}
