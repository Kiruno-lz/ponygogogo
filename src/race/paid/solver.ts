import { normalizeRoster } from '../core/roster.ts'
import { staminaPayment, restoredStamina } from './resources.ts'
import type { Hex } from 'viem'
import { chainEntropy } from '../core/chainEntropy.ts'
import {
  applyPaidChoice, classifyPaidDraw, initialPaidDrawState, resolvePaidAutomaticChoice, type PaidDrawState,
} from '../core/paidDrawRules.ts'
import { paidSettlement } from '../core/paidSettlement.ts'
import { paidSwap } from '../core/paidSwap.ts'
import { paidCardRule, PAID_CARD_COUNT, PAID_CARD_GLOBALS, CARD_MAIN_FUNCTION } from './cardRules.ts'
import { ponyRule } from './ponyRules.ts'
import {
  ADRENALINE_MICRO, AUTO_PANEL_SEC, bonusDurationMs, BONUS_BPS, CHECKPOINT_MICRO, CHOICE_WINDOW_SEC,
  COST_PER_MS, HORSE_COUNT, MAX_BOMBS, MAX_EVENTS, MAX_INSTANCES, MAX_TAU, NEVER, PURPOSE_STEAL, PURPOSE_WIND,
  REGEN_PER_MS, RESPAWN_MS, RK_STEP_MS, SLOT_HOOVES, SLOT_TORSO, SLOW_FACTOR,
  STAMINA_CAPACITY, SWAP_ATTEMPTS, SWAP_EVENT_STRIDE, SWAP_PERIOD_MS, TRACK_MICRO, UNFINISHED_TAU,
  WHEEL_DELTA_V, WHEEL_PERIOD_MS, WIND_BPS, BPS,
} from './constants.ts'
import {
  CLOSE_AUTO, CLOSE_FINISHED, CLOSE_FORFEIT_TX, CLOSE_PICKED, CLOSE_TIMEOUT, EV_BASE_CAP, EV_BOMB_EXPLODE,
  EV_BOMB_PLACE, EV_CARD, EV_CHECKPOINT, EV_CHOICE_INVALID, EV_CPU_CARD_CUT, EV_DEATH, EV_DEATH_IMMUNE, EV_EQUIP_OFF,
  EV_EQUIP_ON, EV_EXHAUST_ENTER, EV_EXHAUST_EXIT, EV_EXPIRE, EV_FINISH, EV_OVERCAP_END, EV_PANEL_AUTO, EV_PANEL_CLOSE,
  EV_PANEL_CUT, EV_PANEL_DEFER, EV_PANEL_OPEN, EV_RESPAWN_END, EV_STEAL, EV_STEAL_NONE, EV_SWAP, EV_SWAP_BLOCKED,
  EV_WHEEL_BURST, EV_WIND, foldPaidEvent, INVALID_AFTER_FINISH, INVALID_AUTO, INVALID_BAD_SLOT, INVALID_CUT,
  INVALID_EARLY, INVALID_EXHAUSTED, INVALID_LATE, INVALID_NO_CREDIT, INVALID_NOT_OFFERED, INVALID_NOT_OPENED,
  OFF_EXPIRED, OFF_REPLACED, OFF_STOLEN, OFF_RECYCLED, EV_TRIGGER, EV_RESOURCE, EV_GUARD, EV_TARGET, EV_EQUIP_REFRESH, EV_FIXED, EV_PONY, PAID_CHOICE_INVALID_NAMES, ZERO_DIGEST, type PaidChoiceInvalidReason,
  type PaidLoggedEvent,
} from './events.ts'
import {
  ceilDiv, firstReach, motionDelta, multiplierOf, staminaAfter, staminaEventDt, wellFieldBps,
  type PaidMotion, type PaidStaminaMotion,
} from './motion.ts'
import type { PaidInstanceEnd, PaidInstanceKind, PaidTrace } from './trace.ts'

export type PaidCoreProfile = { base: bigint; acceleration: bigint; cap: bigint }

/**
 * One stored player transaction for a checkpoint panel; cardId 0 = active forfeit. Values mirror PonyGame storage
 * (txSec uint32, cardId and refresh slots uint8); a slot that breaks a rule counts as no transaction.
 */
export type PaidChoiceSlot = {
  txSec: bigint
  cardId: number
  refreshSlots: readonly number[]
  anchor: Hex
}

export type PaidChoiceSlots = readonly [PaidChoiceSlot | null, PaidChoiceSlot | null, PaidChoiceSlot | null]

/** Fully explicit solver input; there is deliberately no gogo/camera field. */
export type PaidCoreInput = {
  /** Missing only for legacy rules/records. Identity never follows lane changes. */
  roster?: readonly number[]
  profiles: readonly PaidCoreProfile[]
  playerHorseId: number
  playerDeck: readonly number[]
  cpuDecks: readonly (readonly number[])[]
  seed: Hex
  openAnchor: Hex
  choices: PaidChoiceSlots
}

export type PaidSolveOptions = {
  /** Stop right after the player's checkpoint k panel opens (or is cut). */
  stopAtPanel?: 1 | 2 | 3
  /** Stop at this wall ms; an open panel without a recorded choice stays open until its deadline. */
  untilWall?: bigint
  /** Build the rendering trace (default true). */
  trace?: boolean
}

export type PaidPanelMode = 'manual' | 'auto' | 'cut'
export type PaidCheckpointReason =
  'picked' | 'forfeit-tx' | 'timeout' | 'auto' | 'cut' | 'finished' | 'not-reached' | 'open'

export type PaidCheckpointRecord = {
  checkpoint: number
  reached: boolean
  mode: PaidPanelMode | null
  openTau: bigint
  openWall: bigint
  openSec: bigint
  deadlineSec: bigint
  closeWall: bigint
  closeTau: bigint
  reason: PaidCheckpointReason
  cardId: number
  /** Offer after refreshes (manual/auto); empty for cut or unreached checkpoints. */
  candidates: number[]
  /** INVALID_* code when a stored choice for this checkpoint was ignored, else 0. */
  invalidReason: number
}

export type PaidPanelState = {
  checkpoint: number
  mode: PaidPanelMode
  openTau: bigint
  openWall: bigint
  openSec: bigint
  deadlineSec: bigint
  drawState: PaidDrawState
  candidates: number[]
}

export type PaidSolveStatus = 'complete' | 'panel' | 'wall'

export type PaidSolveResult = {
  roster?: readonly number[]
  status: PaidSolveStatus
  tauEnd: bigint
  wallEnd: bigint
  panel: PaidPanelState | null
  finishTime: bigint[]
  finishWall: bigint[]
  rawOrder: number[]
  settlementOrder: number[]
  rawRank: number
  settlementRank: number
  versionAnswer: boolean
  acquired: number[]
  /** IPaidRaceSolver.RaceResult.acquired: card taken at checkpoint k (0 = none). */
  acquiredByCheckpoint: number[]
  checkpoints: PaidCheckpointRecord[]
  eventCount: number
  digest: Hex
  stepCount: number
  events: PaidLoggedEvent[]
  trace: PaidTrace | null
}

type Horse = {
  base: bigint
  accel: bigint
  capMilli: bigint
  pos: bigint
  dist: bigint
  prevPos: bigint
  b: bigint
  s: bigint
  fixed: bigint
  coat: number
  lane: number
  cp: number
  exhausted: boolean
  overcap: boolean
  atCap: boolean
  finished: boolean
  finishTime: bigint
  finishWall: bigint
  blindedPro: boolean
  drawCut: boolean
  bonus: boolean
  equip: number[]
  seenFunctions: number
}

type Instance = {
  ponyId?: number
  id: number
  owner: number
  cardId: number
  kind: PaidInstanceKind
  slot: number
  start: bigint
  end: bigint
  active: boolean
  pBps: bigint
  regenBps: bigint
  airborne: boolean
  wired: boolean
  luck: boolean
  well: boolean
  anchor: Hex
  checkpoint: number
  eventBase: bigint
  count: number
  costDelta: bigint
  fixed: bigint
  gated: boolean
  nextDist: bigint
}

type Bomb = { lane: number; pos: bigint; placer: number; live: boolean }
type PendingBomb = { horse: number; bomb: number; done: boolean }
type CardSource = { anchor: Hex; checkpoint: number; eventBase: bigint }

type OpenPanel = {
  k: number
  mode: 'manual' | 'auto'
  openTau: bigint
  openWall: bigint
  openSec: bigint
  closeWall: bigint
  closeTau: bigint
  slot: PaidChoiceSlot | null
}

type Mods = { pBps: bigint; cost: bigint; regen: bigint; airborne: boolean; wired: boolean; respawning: boolean }

type Due =
  | { cls: 0; id: number }
  | { cls: 1; horse: number; sub: 0 | 1 }
  | { cls: 2; horse: number }
  | { cls: 3; pending: PendingBomb }
  | { cls: 4; id: number }
  | { cls: 5; horse: number }
  | { cls: 6 }

type State = {
  input: PaidCoreInput
  player: number
  horses: Horse[]
  instances: Instance[]
  bombs: Bomb[]
  wind: bigint
  windPlacer: number
  draw: PaidDrawState
  panel: OpenPanel | null
  deferred: number
  records: PaidCheckpointRecord[]
  lastTxAnchor: Hex | null
  mapSlow: boolean
  mapWall: bigint
  mapTau: bigint
  digest: Hex
  events: PaidLoggedEvent[]
  pending: PendingBomb[]
  acquired: number[]
  steps: number
  stopAt: number
  stopPanel: PaidPanelState | null
  trace: PaidTrace | null
}

const ZERO_ANCHOR: Hex = ZERO_DIGEST

function isHex32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function validCardId(id: unknown, allowZero: boolean): boolean {
  return typeof id === 'number' && Number.isInteger(id) && id >= (allowZero ? 0 : 1) && id <= PAID_CARD_COUNT
}

function isUint8(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

function validateInput(input: PaidCoreInput): void {
  if (input.roster !== undefined) normalizeRoster(input.roster)
  const { profiles, playerHorseId, playerDeck, cpuDecks, choices } = input
  if (!Number.isInteger(playerHorseId) || playerHorseId < 0 || playerHorseId >= HORSE_COUNT) {
    throw new Error('INVALID_HORSE')
  }
  if (profiles.length !== HORSE_COUNT) throw new Error('INVALID_PROFILES')
  for (const p of profiles) {
    if (typeof p.base !== 'bigint' || typeof p.acceleration !== 'bigint' || typeof p.cap !== 'bigint'
      || p.base < 0n || p.acceleration < 0n || p.cap < p.base || p.cap > 1_000_000n) {
      throw new Error('INVALID_PROFILES')
    }
  }
  if (playerDeck.length !== 14 || playerDeck.some((id) => !validCardId(id, false))
    || new Set(playerDeck).size !== 14) throw new Error('INVALID_DECK')
  if (cpuDecks.length !== HORSE_COUNT) throw new Error('INVALID_CPU_DECKS')
  for (let h = 0; h < HORSE_COUNT; h++) {
    if (h === playerHorseId) continue
    const deck = cpuDecks[h]!
    if (deck.length !== 3 || deck.some((id) => !validCardId(id, false)) || new Set(deck).size !== 3) {
      throw new Error('INVALID_CPU_DECKS')
    }
  }
  if (!isHex32(input.seed) || !isHex32(input.openAnchor)) throw new Error('INVALID_ANCHOR')
  if (choices.length !== 3) throw new Error('INVALID_CHOICES')
  // Only the representation is checked here: rule-breaking values are judged by the solve itself.
  for (const slot of choices) {
    if (slot === null) continue
    if (typeof slot.txSec !== 'bigint' || slot.txSec < 0n || slot.txSec > NEVER || !isUint8(slot.cardId)
      || !isHex32(slot.anchor) || !Array.isArray(slot.refreshSlots) || !slot.refreshSlots.every(isUint8)) {
      throw new Error('INVALID_CHOICES')
    }
  }
}

function emptyRecord(k: number): PaidCheckpointRecord {
  return {
    checkpoint: k, reached: false, mode: null, openTau: 0n, openWall: 0n, openSec: 0n, deadlineSec: 0n,
    closeWall: 0n, closeTau: 0n, reason: 'not-reached', cardId: 0, candidates: [], invalidReason: 0,
  }
}

function createState(input: PaidCoreInput, opts: PaidSolveOptions): State {
  const horses: Horse[] = []
  for (let h = 0; h < HORSE_COUNT; h++) {
    const p = input.profiles[h]!
    const role = input.roster ? ponyRule(input.roster[h]!) : null
    horses.push({
      base: p.base, accel: p.acceleration, capMilli: (p.cap + BigInt(role?.capDelta ?? 0)) * 1000n,
      pos: 0n, dist: 0n, prevPos: 0n, b: p.base * 1000n, s: STAMINA_CAPACITY, fixed: 0n, coat: 0, lane: h, cp: 0,
      exhausted: false, overcap: false, atCap: false, finished: false, finishTime: UNFINISHED_TAU, finishWall: NEVER,
      blindedPro: false, drawCut: false, bonus: false, equip: [0, 0, 0], seenFunctions: 0,
    })
  }
  const trace: PaidTrace | null = opts.trace === false ? null : {
    ...(input.roster ? { roster: input.roster } : {}),
    tauEnd: 0n, keyframes: [[], [], [], [], []], instances: [], bombs: [], winds: [], cards: [],
    segments: [{ tau: 0n, wall: 0n, slow: false }], events: [], renewals: [],
  }
  return {
    input, player: input.playerHorseId, horses, instances: [], bombs: [], wind: 0n, windPlacer: 0,
    draw: initialPaidDrawState(), panel: null, deferred: 0, records: [emptyRecord(1), emptyRecord(2), emptyRecord(3)],
    lastTxAnchor: null, mapSlow: false, mapWall: 0n, mapTau: 0n, digest: ZERO_DIGEST, events: [], pending: [],
    acquired: [], steps: 0, stopAt: opts.stopAtPanel ?? 0, stopPanel: null, trace,
  }
}

// ---------------------------------------------------------------- bookkeeping

function emit(st: State, code: number, tau: bigint, horse: number, arg: bigint): void {
  if (st.events.length >= MAX_EVENTS) throw new Error('EVENT_LIMIT')
  st.digest = foldPaidEvent(st.digest, code, tau, horse, arg)
  st.events.push({ code, tau, wall: wallAt(st, tau), horse, arg })
}

function wallAt(st: State, tau: bigint): bigint {
  return st.mapWall + (tau - st.mapTau) * (st.mapSlow ? SLOW_FACTOR : 1n)
}

function setMapping(st: State, tau: bigint, wall: bigint, slow: boolean): void {
  st.mapSlow = slow
  st.mapWall = wall
  st.mapTau = tau
  st.trace?.segments.push({ tau, wall, slow })
}

function mods(st: State, h: number): Mods {
  const role = roleOf(st, h)
  let pBps = 0n, regenBps = 0n, costDelta = BigInt(role?.costDeltaBps ?? 0)
  let airborne = false, wired = false, respawning = false
  const horse = st.horses[h]!
  for (const inst of st.instances) {
    if (!inst.active || inst.owner !== h) continue
    if (!inst.gated) { pBps += inst.pBps; regenBps += inst.regenBps }
    costDelta += inst.costDelta
    airborne ||= inst.airborne
    wired ||= inst.wired
    respawning ||= inst.kind === 'respawn'
  }
  for (const inst of st.instances) {
    if (!inst.active || inst.owner !== h || !inst.gated) continue
    const r = paidCardRule(inst.cardId)
    switch (r.effect) {
      case 'rage': pBps += BigInt(r.pBps!) + (wired ? BigInt(r.bonusBps!) : 0n); break
      case 'paper': pBps += BigInt(r.pBps!) + (airborne ? BigInt(r.bonusBps!) : 0n); break
      case 'ground': if (!airborne) pBps += BigInt(r.pBps!); break
      case 'coatGate':
        if (horse.coat === paidCardRule(19).coatRgb) pBps += BigInt(r.pBps!)
        else if (horse.coat === paidCardRule(20).coatRgb) regenBps += BigInt(r.regenBonusBps!)
        else pBps += BigInt(r.fallbackBps!)
        break
      case 'unarmed': pBps += BigInt(horse.equip.some(Boolean) ? r.fallbackBps! : r.pBps!); break
    }
  }
  if (st.wind !== 0n && airborne && (!horse.blindedPro || st.windPlacer === h)) pBps += st.wind
  if ((role?.ability === 'light' && !horse.equip.some(Boolean)) || (role?.ability === 'airborne' && airborne)) pBps += BigInt(role.bonusBps!)
  const factor = BPS + costDelta
  return { pBps, cost: COST_PER_MS * (factor < BigInt(PAID_CARD_GLOBALS.minCostFactorBps) ? BigInt(PAID_CARD_GLOBALS.minCostFactorBps) : factor) / BPS,
    regen: REGEN_PER_MS * (BPS + regenBps) / BPS, airborne, wired, respawning }
}

function staminaMotion(horse: Horse, m: Mods): PaidStaminaMotion {
  return { s: horse.s, exhausted: horse.exhausted, overcap: horse.overcap, wired: m.wired, cost: m.cost, regen: m.regen }
}

function motionOf(horse: Horse, pBps: bigint): PaidMotion {
  return {
    exhausted: horse.exhausted,
    b: horse.b,
    aEff: !horse.exhausted && horse.b < horse.capMilli ? horse.accel : 0n,
    mult: multiplierOf(pBps),
    fixed: horse.fixed,
  }
}

function addInstance(
  st: State, tau: bigint, owner: number, cardId: number, kind: Instance['kind'], duration: bigint | null,
  fields: Partial<Instance> = {},
): Instance {
  if (st.instances.length >= MAX_INSTANCES) throw new Error('INSTANCE_LIMIT')
  const inst: Instance = {
    id: st.instances.length + 1, owner, cardId, kind, slot: -1, start: tau,
    end: duration === null ? NEVER : tau + duration, active: true,
    pBps: 0n, regenBps: 0n, airborne: false, wired: false, luck: false, well: false,
    anchor: ZERO_ANCHOR, checkpoint: 0, eventBase: 0n, count: 0, costDelta: 0n, fixed: 0n, gated: false, nextDist: 0n, ...fields,
  }
  st.instances.push(inst)
  st.horses[owner]!.fixed += inst.fixed
  st.trace?.instances.push({
    ...(inst.ponyId === undefined ? {} : { ponyId: inst.ponyId }),
    id: inst.id, horse: owner, cardId, kind, initialP: inst.pBps, slot: inst.slot, startTau: tau,
    plannedEndTau: duration === null ? null : inst.end, endTau: null, endReason: null,
  })
  return inst
}

function endInstance(st: State, inst: Instance, tau: bigint, reason: PaidInstanceEnd): void {
  inst.active = false
  st.horses[inst.owner]!.fixed -= inst.fixed
  inst.fixed = 0n
  if (inst.slot >= 0 && st.horses[inst.owner]!.equip[inst.slot] === inst.id) st.horses[inst.owner]!.equip[inst.slot] = 0
  const traced = st.trace?.instances[inst.id - 1]
  if (traced) {
    traced.endTau = tau
    traced.endReason = reason
  }
}

// ---------------------------------------------------------------- due scan

function baseDue(horse: Horse): boolean {
  return !horse.atCap && horse.b >= horse.capMilli
}

function findDue(st: State, tau: bigint): Due | null {
  for (const inst of st.instances) if (inst.active && inst.end === tau) return { cls: 0, id: inst.id }
  for (let h = 0; h < HORSE_COUNT; h++) {
    const horse = st.horses[h]!
    if (horse.finished) continue
    if (baseDue(horse)) return { cls: 1, horse: h, sub: 0 }
    if (staminaEventDt(staminaMotion(horse, mods(st, h))) === 0n) return { cls: 1, horse: h, sub: 1 }
  }
  for (let h = 0; h < HORSE_COUNT; h++) {
    const horse = st.horses[h]!
    if (!horse.finished && horse.pos >= TRACK_MICRO) return { cls: 2, horse: h }
  }
  for (const pending of st.pending) if (!pending.done) return { cls: 3, pending }
  for (const inst of st.instances) {
    if (!inst.active) continue
    if (triggerAt(st, inst, tau) === tau) return { cls: 4, id: inst.id }
  }
  for (let h = 0; h < HORSE_COUNT; h++) {
    const horse = st.horses[h]!
    if (!horse.finished && horse.cp < 3 && horse.dist >= CHECKPOINT_MICRO[horse.cp]!) return { cls: 5, horse: h }
  }
  if (st.panel !== null && st.panel.closeTau === tau) return { cls: 6 }
  return null
}

function stampOf(st: State, due: Due, tau: bigint): bigint {
  return due.cls === 6 ? st.panel!.closeWall : wallAt(st, tau)
}

// ---------------------------------------------------------------- effects

function kill(st: State, h: number, tau: bigint): void {
  const horse = st.horses[h]!
  if (horse.finished) return
  if (mods(st, h).respawning) { emit(st, EV_DEATH_IMMUNE, tau, h, 0n); return }
  const shield = st.instances.find((i) => i.active && i.owner === h && i.kind === 'watch' && i.cardId === 37)
  if (shield) {
    endInstance(st, shield, tau, 'consumed')
    emit(st, EV_GUARD, tau, h, BigInt(shield.id))
    return
  }
  for (const i of st.instances) if (i.active && i.owner === h && i.kind === 'fixed') endInstance(st, i, tau, 'death')
  horse.b = 0n; horse.fixed = 0n; horse.atCap = false
  const respawn = addInstance(st, tau, h, 0, 'respawn', RESPAWN_MS)
  emit(st, EV_DEATH, tau, h, BigInt(respawn.id))
  const listener = st.instances.find((i) => i.active && i.owner === h && i.kind === 'watch' && i.cardId === 38 && tau < i.end)
  if (listener) {
    endInstance(st, listener, tau, 'consumed')
    triggerLog(st, listener, tau)
    const r = paidCardRule(38)
    addInstance(st, tau, h, 38, 'fixed', BigInt(r.triggerDurationMs!), { fixed: BigInt(r.fixedSpeed!) })
    emit(st, EV_FIXED, tau, h, BigInt(r.fixedSpeed!))
  }
}

function recover(st: State, h: number, amount: bigint, tau: bigint): void {
  const horse = st.horses[h]!
  const gain = restoredStamina(horse.s, amount) - horse.s
  horse.s += gain
  emit(st, EV_RESOURCE, tau, h, gain)
}

function triggerLog(st: State, inst: Instance, tau: bigint): void {
  inst.count++
  emit(st, EV_TRIGGER, tau, inst.owner, BigInt(inst.cardId * 256 + inst.count))
}

function onEquipment(st: State, h: number, tau: bigint): void {
  const listeners = st.instances.filter((i) => i.active && i.owner === h && i.kind === 'watch' && i.cardId === 31)
  for (const i of listeners) {
    const r = paidCardRule(31)
    triggerLog(st, i, tau)
    addInstance(st, tau, h, 31, 'buff', BigInt(r.triggerDurationMs!), { pBps: BigInt(r.bonusBps!) })
  }
}

function triggerAt(st: State, i: Instance, tau: bigint): bigint {
  if (!i.active) return NEVER
  if (i.kind === 'ability' && i.count < SWAP_ATTEMPTS) return i.start + SWAP_PERIOD_MS * BigInt(i.count)
  if (i.kind === 'equip' && i.cardId === 11) {
    const at = i.start + WHEEL_PERIOD_MS * BigInt(i.count + 1)
    return at < i.end ? at : NEVER
  }
  if (i.kind !== 'watch' || tau >= i.end) return NEVER
  const r = paidCardRule(i.cardId)
  if (r.effect === 'phased' && i.count === 0) return i.start + BigInt(r.periodMs!)
  if (r.effect === 'reserve') {
    const h = st.horses[i.owner]!
    const threshold = BigInt(r.thresholdMicro!)
    if (h.s <= threshold) return tau
    const m = mods(st, i.owner)
    if (!h.exhausted && !h.overcap && m.cost > m.regen) return tau + ceilDiv(h.s - threshold, m.cost - m.regen)
  }
  if (r.effect === 'mileage' && i.count < r.count! && st.horses[i.owner]!.dist >= i.nextDist) return tau
  return NEVER
}

type EquipSpec = { slot: number; duration: bigint; fields: Partial<Instance> }

function equipSpec(cardId: number): EquipSpec {
  const rule = paidCardRule(cardId)
  const duration = BigInt(rule.durationMs!)
  switch (rule.effect) {
    case 'rocket': return { slot: rule.slot!, duration, fields: { pBps: BigInt(rule.pBps!), costDelta: BigInt(rule.costMultiplierBps!) - BPS } }
    case 'rainbow': return { slot: rule.slot!, duration, fields: { pBps: BigInt(rule.pBps!) } }
    case 'gravity': return { slot: rule.slot!, duration, fields: { well: true } }
    case 'wheel': return { slot: rule.slot!, duration, fields: { airborne: true } }
    default: throw new Error('NOT_EQUIPMENT')
  }
}

function equip(st: State, h: number, cardId: number, tau: bigint, acquired = true, transferredDuration?: bigint): bigint {
  const spec = equipSpec(cardId)
  const role = roleOf(st, h)
  const duration = transferredDuration ?? (acquired && role?.ability === 'longEquipment'
    ? spec.duration * BigInt(role.equipmentDurationBps!) / BPS : spec.duration)
  const horse = st.horses[h]!
  const oldId = horse.equip[spec.slot]!
  if (oldId !== 0) {
    endInstance(st, st.instances[oldId - 1]!, tau, 'replaced')
    emit(st, EV_EQUIP_OFF, tau, h, BigInt(oldId) * 4n + BigInt(OFF_REPLACED))
  }
  const inst = addInstance(st, tau, h, cardId, 'equip', duration, { ...spec.fields, slot: spec.slot })
  horse.equip[spec.slot] = inst.id
  emit(st, EV_EQUIP_ON, tau, h, BigInt(inst.id))
  onEquipment(st, h, tau)
  return duration
}

function placeBombs(st: State, h: number, tau: bigint): void {
  const placer = st.horses[h]!
  for (let lane = 0; lane < HORSE_COUNT; lane++) {
    if (lane === placer.lane) continue
    if (st.bombs.length >= MAX_BOMBS) throw new Error('BOMB_LIMIT')
    const id = st.bombs.length
    st.bombs.push({ lane, pos: placer.pos, placer: h, live: true })
    st.trace?.bombs.push({ id, lane, pos: placer.pos, placer: h, placedTau: tau, goneTau: null, victim: null })
    emit(st, EV_BOMB_PLACE, tau, h, placer.pos * 8n + BigInt(lane))
  }
}

function steal(st: State, h: number, src: CardSource, tau: bigint): bigint {
  const candidates: number[] = []
  for (let victim = 0; victim < HORSE_COUNT; victim++) {
    if (victim === h || st.horses[victim]!.finished) continue
    for (let slot = SLOT_TORSO; slot <= SLOT_HOOVES; slot++) {
      const id = st.horses[victim]!.equip[slot]!
      if (id !== 0) candidates.push(id)
    }
  }
  if (candidates.length === 0) {
    emit(st, EV_STEAL_NONE, tau, h, 0n)
    return 0n
  }
  const pick = chainEntropy(st.input.seed, src.anchor, src.checkpoint, PURPOSE_STEAL, src.eventBase)
    % BigInt(candidates.length)
  const loot = st.instances[candidates[Number(pick)]! - 1]!
  emit(st, EV_STEAL, tau, h, BigInt(loot.id))
  endInstance(st, loot, tau, 'stolen')
  emit(st, EV_EQUIP_OFF, tau, loot.owner, BigInt(loot.id) * 4n + BigInt(OFF_STOLEN))
  return equip(st, h, loot.cardId, tau, false, st.input.roster ? loot.end - tau : undefined)
}

function applyCard(st: State, h: number, cardId: number, src: CardSource, tau: bigint): void {
  const horse = st.horses[h]!
  const staminaBefore = horse.s
  const rule = paidCardRule(cardId)
  emit(st, EV_CARD, tau, h, BigInt(cardId))
  st.trace?.cards.push({ tau, horse: h, cardId })
  let lootMs = 0n
  switch (rule.effect) {
    case 'airborneSpeed': addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!), airborne: true }); break
    case 'speedDeath': addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!), luck: true }); break
    case 'drawCut':
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!) })
      horse.drawCut = true
      break
    case 'bomb': placeBombs(st, h, tau); break
    case 'rocket': case 'rainbow': case 'gravity': case 'wheel': equip(st, h, cardId, tau); break
    case 'swap': addInstance(st, tau, h, cardId, 'ability', BigInt(rule.durationMs!), src); break
    case 'wind': {
      const draw = chainEntropy(st.input.seed, src.anchor, src.checkpoint, PURPOSE_WIND, src.eventBase)
      st.wind = draw % 2n === 0n ? -WIND_BPS : WIND_BPS
      st.windPlacer = h
      st.trace?.winds.push({ tau, bps: st.wind, placer: h })
      emit(st, EV_WIND, tau, h, st.wind)
      break
    }
    case 'steal': lootMs = steal(st, h, src, tau); break
    case 'regen': addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { regenBps: BigInt(rule.regenBonusBps!) }); break
    case 'adrenaline':
      horse.s += ADRENALINE_MICRO
      if (!horse.exhausted) horse.overcap = horse.s > STAMINA_CAPACITY
      break
    case 'wired':
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { wired: true })
      if (horse.exhausted) {
        horse.exhausted = false
        horse.overcap = false
        emit(st, EV_EXHAUST_EXIT, tau, h, horse.s)
      }
      break
    case 'coat': horse.coat = rule.coatRgb!; break
    case 'fixed': horse.fixed += BigInt(rule.fixedSpeed!); break
    case 'blindFixed':
      horse.fixed += BigInt(rule.fixedSpeed!)
      horse.blindedPro = true
      break
    case 'pay': {
      const { paid, bps } = staminaPayment(horse.s)
      horse.s -= paid
      emit(st, EV_RESOURCE, tau, h, -paid)
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: bps })
      break
    }
    case 'phased': addInstance(st, tau, h, cardId, 'watch', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!), regenBps: BigInt(rule.regenBonusBps!) }); break
    case 'reserve':
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.periodMs!), { pBps: BigInt(rule.pBps!) })
      addInstance(st, tau, h, cardId, 'watch', BigInt(rule.durationMs!)); break
    case 'thrift': addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!), costDelta: BigInt(rule.costDeltaBps!) }); break
    case 'rage': case 'paper': case 'ground': case 'coatGate': case 'unarmed':
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { gated: true, costDelta: BigInt(rule.costDeltaBps ?? 0) }); break
    case 'recycle': {
      const candidates = st.instances.filter((i) => i.active && i.owner === h && i.kind === 'equip').sort((a,b) => a.end < b.end ? -1 : a.end > b.end ? 1 : a.id - b.id)
      const old = candidates[0]
      lootMs = BigInt(old ? rule.durationMs! : rule.periodMs!)
      if (old) { endInstance(st, old, tau, 'recycled'); emit(st, EV_EQUIP_OFF, tau, h, BigInt(old.id * 4 + OFF_RECYCLED)); recover(st, h, BigInt(rule.staminaMicro!), tau) }
      addInstance(st, tau, h, cardId, 'buff', lootMs, { pBps: BigInt(old ? rule.pBps! : rule.fallbackBps!) }); break
    }
    case 'tinker':
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.periodMs!), { pBps: BigInt(rule.pBps!) })
      addInstance(st, tau, h, cardId, 'watch', null)
      if (horse.equip.some(Boolean)) onEquipment(st, h, tau)
      break
    case 'renew': {
      let renewed = false
      for (const id of horse.equip) {
        if (!id) continue
        const i = st.instances[id - 1]!
        i.end = tau + BigInt(paidCardRule(i.cardId).durationMs!)
        st.trace?.renewals.push({ instanceId: id, tau, end: i.end })
        emit(st, EV_EQUIP_REFRESH, tau, h, BigInt(id)); renewed = true
      }
      if (!renewed) { lootMs = BigInt(rule.periodMs!); addInstance(st, tau, h, cardId, 'buff', lootMs, { pBps: BigInt(rule.fallbackBps!) }) }
      break
    }
    case 'target': {
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!) })
      const targets = st.horses.map((x, id) => ({ x, id })).filter(({ x, id }) => id !== h && !x.finished && !x.blindedPro && x.pos > horse.pos)
        .sort((a,b) => a.x.pos < b.x.pos ? -1 : a.x.pos > b.x.pos ? 1 : a.id - b.id)
      const target = targets[0]?.id ?? 255
      emit(st, EV_TARGET, tau, h, BigInt(target))
      if (target !== 255) addInstance(st, tau, target, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.fallbackBps!) })
      break
    }
    case 'leader': {
      const first = !st.horses.some((x,id) => id !== h && (x.finished || x.pos > horse.pos || (x.pos === horse.pos && id < h)))
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(first ? rule.pBps! : rule.fallbackBps!) }); break
    }
    case 'feast':
      for (let target = 0; target < HORSE_COUNT; target++) if (!st.horses[target]!.finished) recover(st, target, BigInt(rule.staminaMicro!), tau)
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.durationMs!), { pBps: BigInt(rule.pBps!) }); break
    case 'guard': addInstance(st, tau, h, cardId, 'watch', null); break
    case 'deathBurst': addInstance(st, tau, h, cardId, 'watch', BigInt(rule.durationMs!)); break
    case 'forfeit':
      addInstance(st, tau, h, cardId, 'buff', BigInt(rule.periodMs!), { pBps: BigInt(rule.pBps!) })
      addInstance(st, tau, h, cardId, 'watch', null); break
    case 'mileage':
      horse.fixed += BigInt(rule.fixedSpeed!)
      emit(st, EV_FIXED, tau, h, BigInt(rule.fixedSpeed!))
      addInstance(st, tau, h, cardId, 'watch', null, { nextDist: horse.dist + BigInt(rule.radiusMicro!) }); break
    default: break
  }
  if (horse.bonus) addInstance(st, tau, h, cardId, 'bonus', bonusDurationMs(cardId, lootMs), { pBps: BONUS_BPS })
  if (rule.effect === 'drawAuto') horse.bonus = true
  onPonyCard(st, h, cardId, staminaBefore, lootMs, tau)
}

function roleOf(st: State, h: number) { return st.input.roster ? ponyRule(st.input.roster[h]!) : null }

function ponyTrigger(st: State, h: number, cardId: number, tau: bigint): void {
  const role = roleOf(st, h)!
  emit(st, EV_PONY, tau, h, BigInt(role.id * 65536 + cardId * 256 + 1))
}

function ponySpeed(st: State, h: number, cardId: number, tau: bigint): void {
  const role = roleOf(st, h)!
  addInstance(st, tau, h, cardId, 'trait', BigInt(role.durationMs!), { pBps: BigInt(role.bonusBps!), ponyId: role.id })
  ponyTrigger(st, h, cardId, tau)
}

function ponyFood(st: State, h: number, cardId: number, before: bigint, tau: bigint): void {
  const role = roleOf(st, h), horse = st.horses[h]!
  if (role?.ability !== 'food' || paidCardRule(cardId).mainFunction !== 'supply' || horse.s <= before) return
  recover(st, h, BigInt(role.staminaMicro!), tau)
  ponyTrigger(st, h, cardId, tau)
}

function onPonyCard(st: State, h: number, cardId: number, before: bigint, lootMs: bigint, tau: bigint): void {
  const role = roleOf(st, h)
  if (!role) return
  const card = paidCardRule(cardId), horse = st.horses[h]!
  const bit = 1 << CARD_MAIN_FUNCTION[card.mainFunction]
  const seen = (horse.seenFunctions & bit) !== 0
  if (role.ability === 'rareSpecialist' && card.rare) {
    addInstance(st, tau, h, cardId, 'bonus', bonusDurationMs(cardId, lootMs), { pBps: BigInt(role.bonusBps!), ponyId: role.id })
    ponyTrigger(st, h, cardId, tau)
  } else if ((role.ability === 'diverse' && !seen) || (role.ability === 'repeat' && seen)) ponySpeed(st, h, cardId, tau)
  ponyFood(st, h, cardId, before, tau)
  horse.seenFunctions |= bit
}

// ---------------------------------------------------------------- panels

function candidatesAt(st: State): number[] {
  return st.input.playerDeck.slice(st.draw.cursor, st.draw.cursor + 3)
}

function panelState(st: State, panel: OpenPanel): PaidPanelState {
  return {
    checkpoint: panel.k, mode: panel.mode, openTau: panel.openTau, openWall: panel.openWall, openSec: panel.openSec,
    deadlineSec: panel.openSec + (panel.mode === 'auto' ? AUTO_PANEL_SEC : CHOICE_WINDOW_SEC),
    drawState: { ...st.draw }, candidates: candidatesAt(st),
  }
}

/** The stored choice for checkpoint k is ignored; the checkpoint proceeds as without a transaction. */
function invalidChoice(st: State, k: number, tau: bigint, reason: number): void {
  st.records[k - 1]!.invalidReason = reason
  emit(st, EV_CHOICE_INVALID, tau, st.player, BigInt(k * 16 + reason))
}

/**
 * A stored choice is judged when its panel opens, before the close time is fixed: cut, auto, outside
 * [openSec, openSec + 20), then applyPaidChoice's refresh and card rules. An invalid one is dropped, so the panel is
 * cut, auto or times out exactly as without a transaction.
 */
function openPanel(st: State, k: number, tau: bigint): void {
  const stamp = wallAt(st, tau)
  const rec = st.records[k - 1]!
  let slot = st.input.choices[k - 1] ?? null
  rec.reached = true
  rec.openTau = tau
  rec.openWall = stamp
  if (st.draw.forfeited) {
    Object.assign(rec, { mode: 'cut', reason: 'cut', closeWall: stamp, closeTau: tau })
    emit(st, EV_PANEL_CUT, tau, st.player, BigInt(k))
    if (slot !== null) invalidChoice(st, k, tau, INVALID_CUT)
    if (st.stopAt === k) {
      st.stopPanel = {
        checkpoint: k, mode: 'cut', openTau: tau, openWall: stamp, openSec: 0n, deadlineSec: 0n,
        drawState: { ...st.draw }, candidates: [],
      }
    }
    return
  }
  const openSec = ceilDiv(stamp, 1000n)
  let invalid = 0
  if (slot !== null) {
    if (st.draw.automatic) invalid = INVALID_AUTO
    else if (slot.txSec < openSec) invalid = INVALID_EARLY
    else if (slot.txSec >= openSec + CHOICE_WINDOW_SEC) invalid = INVALID_LATE
    else invalid = classifyPaidDraw(st.input.playerDeck, st.draw, slot.refreshSlots, slot.cardId)
    if (invalid !== 0) slot = null
  }
  const mode: 'manual' | 'auto' = st.draw.automatic ? 'auto' : 'manual'
  let closeWall: bigint
  if (mode === 'auto') closeWall = (openSec + AUTO_PANEL_SEC) * 1000n
  else closeWall = slot !== null ? slot.txSec * 1000n : (openSec + CHOICE_WINDOW_SEC) * 1000n
  const panel: OpenPanel = {
    k, mode, openTau: tau, openWall: stamp, openSec, closeWall, closeTau: tau + (closeWall - stamp) / SLOW_FACTOR, slot,
  }
  st.panel = panel
  Object.assign(rec, {
    mode, reason: 'open', openSec, deadlineSec: panelState(st, panel).deadlineSec, candidates: candidatesAt(st),
  })
  setMapping(st, tau, stamp, true)
  emit(st, mode === 'auto' ? EV_PANEL_AUTO : EV_PANEL_OPEN, tau, st.player, BigInt(k))
  if (invalid !== 0) invalidChoice(st, k, tau, invalid)
  if (st.stopAt === k) st.stopPanel = panelState(st, panel)
}

function offeredAfterRefresh(deck: readonly number[], draw: PaidDrawState, refreshSlots: readonly number[]): number[] {
  const offer = deck.slice(draw.cursor, draw.cursor + 3)
  let tail = draw.tailCursor
  for (const slot of refreshSlots) offer[slot] = deck[--tail]!
  return offer
}

function closePanel(st: State, tau: bigint): void {
  const panel = st.panel!
  const rec = st.records[panel.k - 1]!
  const deck = st.input.playerDeck
  let cardId = 0
  let reason: PaidCheckpointReason
  let code: number
  let src: CardSource | null = null
  let offer = candidatesAt(st)
  if (panel.mode === 'auto') {
    if (st.lastTxAnchor === null) throw new Error('NO_AUTOPICK_ANCHOR')
    const auto = resolvePaidAutomaticChoice(deck, st.draw, st.input.seed, st.lastTxAnchor, panel.k)
    st.draw = auto.state
    cardId = auto.cardId
    reason = 'auto'
    code = CLOSE_AUTO
    src = { anchor: st.lastTxAnchor, checkpoint: panel.k, eventBase: 0n }
  } else if (panel.slot !== null) {
    const slot = panel.slot
    const next = applyPaidChoice(deck, st.draw, slot.refreshSlots, slot.cardId)
    offer = offeredAfterRefresh(deck, st.draw, slot.refreshSlots)
    st.draw = next
    cardId = slot.cardId
    reason = cardId === 0 ? 'forfeit-tx' : 'picked'
    code = cardId === 0 ? CLOSE_FORFEIT_TX : CLOSE_PICKED
    st.lastTxAnchor = slot.anchor
    src = { anchor: slot.anchor, checkpoint: panel.k, eventBase: 0n }
  } else {
    st.draw = applyPaidChoice(deck, st.draw, [], 0)
    reason = 'timeout'
    code = CLOSE_TIMEOUT
  }
  Object.assign(rec, { reason, cardId, closeWall: panel.closeWall, closeTau: tau, candidates: offer })
  st.panel = null
  setMapping(st, tau, panel.closeWall, false)
  emit(st, EV_PANEL_CLOSE, tau, st.player, BigInt(panel.k * 16 + code))
  if (cardId !== 0) {
    st.acquired.push(cardId)
    applyCard(st, st.player, cardId, src!, tau)
  }
  if (reason === 'forfeit-tx') {
    if (roleOf(st, st.player)?.ability === 'forfeit') ponySpeed(st, st.player, 0, tau)
    const i = st.instances.find((i) => i.active && i.owner === st.player && i.kind === 'watch' && i.cardId === 39 && i.start < tau)
    if (i) {
      const r = paidCardRule(39)
      endInstance(st, i, tau, 'consumed'); triggerLog(st, i, tau)
      recover(st, st.player, BigInt(r.staminaMicro!), tau)
      addInstance(st, tau, st.player, 39, 'buff', BigInt(r.triggerDurationMs!), { pBps: BigInt(r.bonusBps!) })
    }
  }
  openDeferred(st, tau)
}

/** Opens thresholds crossed while a panel was open, in order; a cut one opens nothing, so the next follows at once. */
function openDeferred(st: State, tau: bigint): void {
  while (st.deferred !== 0 && st.panel === null && st.stopPanel === null) {
    const k = st.deferred
    st.deferred = st.horses[st.player]!.cp > k ? k + 1 : 0
    openPanel(st, k, tau)
  }
}

// ---------------------------------------------------------------- event handlers

function applyDue(st: State, due: Due, tau: bigint): void {
  switch (due.cls) {
    case 0: {
      const inst = st.instances[due.id - 1]!
      endInstance(st, inst, tau, 'expired')
      if (inst.kind === 'equip') emit(st, EV_EQUIP_OFF, tau, inst.owner, BigInt(inst.id) * 4n + BigInt(OFF_EXPIRED))
      else if (inst.kind === 'respawn') emit(st, EV_RESPAWN_END, tau, inst.owner, BigInt(inst.id))
      else emit(st, EV_EXPIRE, tau, inst.owner, BigInt(inst.id))
      if (inst.luck) kill(st, inst.owner, tau)
      return
    }
    case 1: {
      const horse = st.horses[due.horse]!
      if (due.sub === 0) {
        horse.b = horse.capMilli
        horse.atCap = true
        emit(st, EV_BASE_CAP, tau, due.horse, horse.b)
      } else if (horse.exhausted) {
        horse.exhausted = false
        horse.overcap = horse.s > STAMINA_CAPACITY
        emit(st, EV_EXHAUST_EXIT, tau, due.horse, horse.s)
      } else if (horse.overcap) {
        horse.overcap = false
        emit(st, EV_OVERCAP_END, tau, due.horse, horse.s)
      } else {
        horse.s = 0n
        horse.exhausted = true
        emit(st, EV_EXHAUST_ENTER, tau, due.horse, 0n)
      }
      return
    }
    case 2: finish(st, due.horse, tau); return
    case 3: {
      const pending = due.pending
      pending.done = true
      const bomb = st.bombs[pending.bomb]!
      if (!bomb.live || st.horses[pending.horse]!.finished) return
      bomb.live = false
      const traced = st.trace?.bombs[pending.bomb]
      if (traced) {
        traced.goneTau = tau
        traced.victim = pending.horse
      }
      emit(st, EV_BOMB_EXPLODE, tau, pending.horse, BigInt(pending.bomb))
      kill(st, pending.horse, tau)
      return
    }
    case 4: {
      const inst = st.instances[due.id - 1]!
      if (inst.kind === 'ability') swapAttempt(st, inst, tau)
      else if (inst.kind === 'watch') {
        const r = paidCardRule(inst.cardId)
        triggerLog(st, inst, tau)
        if (r.effect === 'phased') { inst.pBps = BigInt(r.bonusBps!); inst.regenBps = 0n }
        else if (r.effect === 'reserve') {
          const before = st.horses[inst.owner]!.s
          endInstance(st, inst, tau, 'consumed'); recover(st, inst.owner, BigInt(r.staminaMicro!), tau)
          if (inst.start === tau) ponyFood(st, inst.owner, inst.cardId, before, tau)
        }
        else if (r.effect === 'mileage') { inst.nextDist += BigInt(r.radiusMicro!); st.horses[inst.owner]!.fixed += BigInt(r.triggerFixedSpeed!); emit(st, EV_FIXED, tau, inst.owner, BigInt(r.triggerFixedSpeed!)) }
      } else {
        inst.count++
        st.horses[inst.owner]!.fixed += WHEEL_DELTA_V
        emit(st, EV_WHEEL_BURST, tau, inst.owner, BigInt(inst.count))
      }
      return
    }
    case 5: checkpoint(st, due.horse, tau); return
    case 6: closePanel(st, tau); return
  }
}

function swapAttempt(st: State, inst: Instance, tau: bigint): void {
  const attempt = inst.count
  inst.count++
  const view = st.horses.map((horse) => ({
    laneIndex: horse.lane, pos: horse.pos, dist: horse.dist, finished: horse.finished, immune: horse.blindedPro,
  }))
  const eventIndex = inst.eventBase * SWAP_EVENT_STRIDE + BigInt(attempt)
  const result = paidSwap(view, inst.owner, st.input.seed, inst.anchor, inst.checkpoint, eventIndex)
  const arg = BigInt(attempt * 8 + result.targetHorseId)
  if (!result.swapped) {
    emit(st, EV_SWAP_BLOCKED, tau, inst.owner, arg)
    return
  }
  for (const h of [inst.owner, result.targetHorseId]) {
    st.horses[h]!.pos = result.horses[h]!.pos
    st.horses[h]!.lane = result.horses[h]!.laneIndex
  }
  emit(st, EV_SWAP, tau, inst.owner, arg)
}

function finish(st: State, h: number, tau: bigint): void {
  const horse = st.horses[h]!
  horse.finished = true
  horse.finishTime = tau
  horse.finishWall = wallAt(st, tau)
  emit(st, EV_FINISH, tau, h, horse.pos)
  for (const inst of st.instances) if (inst.active && inst.owner === h) endInstance(st, inst, tau, 'finished')
  st.trace?.keyframes[h]!.push(frozenFrame(st, h, tau))
  if (h !== st.player) return
  const stamp = wallAt(st, tau)
  if (st.deferred !== 0) {
    for (let k = st.deferred; k <= horse.cp; k++) Object.assign(st.records[k - 1]!, { reason: 'finished', closeWall: stamp, closeTau: tau })
  }
  st.deferred = 0
  const panel = st.panel
  if (panel === null) return
  Object.assign(st.records[panel.k - 1]!, { reason: 'finished', closeWall: stamp, closeTau: tau })
  st.panel = null
  setMapping(st, tau, stamp, false)
  emit(st, EV_PANEL_CLOSE, tau, h, BigInt(panel.k * 16 + CLOSE_FINISHED))
  // The player reached the line before txSec (txSec·1000 >= finishWall): the choice never took effect.
  if (panel.slot !== null) invalidChoice(st, panel.k, tau, INVALID_AFTER_FINISH)
}

function checkpoint(st: State, h: number, tau: bigint): void {
  const horse = st.horses[h]!
  horse.cp++
  const k = horse.cp
  emit(st, EV_CHECKPOINT, tau, h, BigInt(k))
  if (h !== st.player) {
    if (horse.drawCut) emit(st, EV_CPU_CARD_CUT, tau, h, BigInt(k))
    else {
      const src = { anchor: st.input.openAnchor, checkpoint: 0, eventBase: BigInt(h * 3 + k - 1) }
      applyCard(st, h, st.input.cpuDecks[h]![k - 1]!, src, tau)
    }
    return
  }
  if (st.panel !== null) {
    st.records[k - 1]!.reached = true
    if (st.deferred === 0) st.deferred = k
    emit(st, EV_PANEL_DEFER, tau, h, BigInt(k))
    return
  }
  openPanel(st, k, tau)
}

// ---------------------------------------------------------------- motion

function nextKnownTau(st: State, tau: bigint): bigint {
  let next = MAX_TAU
  for (const inst of st.instances) {
    if (!inst.active) continue
    if (inst.end < next) next = inst.end
    const at = triggerAt(st, inst, tau)
    if (at < next) next = at
  }
  for (let h = 0; h < HORSE_COUNT; h++) {
    const horse = st.horses[h]!
    if (horse.finished) continue
    if (!horse.atCap && !horse.exhausted && horse.accel > 0n && horse.b < horse.capMilli) {
      const at = tau + ceilDiv(horse.capMilli - horse.b, horse.accel)
      if (at < next) next = at
    }
    const dt = staminaEventDt(staminaMotion(horse, mods(st, h)))
    if (dt !== null && tau + dt < next) next = tau + dt
  }
  if (st.panel !== null && st.panel.closeTau < next) next = st.panel.closeTau
  if (next <= tau) throw new Error('NO_PROGRESS')
  return next
}

function wellOwners(st: State): number[] {
  const owners: number[] = []
  for (const inst of st.instances) if (inst.active && inst.well) owners.push(inst.owner)
  return owners
}

function fieldsAt(st: State, owners: readonly number[], positions: readonly bigint[]): bigint[] {
  const out = [0n, 0n, 0n, 0n, 0n]
  for (let target = 0; target < HORSE_COUNT; target++) {
    if (st.horses[target]!.finished) continue
    for (const owner of owners) if (owner !== target) out[target]! += wellFieldBps(positions[owner]!, positions[target]!)
  }
  return out
}

function crossingNeed(st: State, h: number, airborne: boolean): bigint {
  const horse = st.horses[h]!
  let need = TRACK_MICRO - horse.pos
  if (horse.cp < 3) {
    const toCheckpoint = CHECKPOINT_MICRO[horse.cp]! - horse.dist
    if (toCheckpoint < need) need = toCheckpoint
  }
  for (const i of st.instances) {
    if (i.active && i.owner === h && i.kind === 'watch' && i.cardId === 40 && i.count < paidCardRule(40).count!) {
      const remaining = i.nextDist - horse.dist
      if (remaining < need) need = remaining
    }
  }
  if (!airborne) {
    for (const bomb of st.bombs) {
      if (!bomb.live || bomb.lane !== horse.lane || bomb.pos <= horse.pos) continue
      if (horse.blindedPro && bomb.placer !== h) continue
      if (bomb.pos - horse.pos < need) need = bomb.pos - horse.pos
    }
  }
  return need
}

/** Advance every running horse by one interval (analytic) or one RK2 step, truncated at the first crossing. */
function advance(st: State, tau: bigint, maxDt: bigint): bigint {
  const running: number[] = []
  const staticMods: Mods[] = []
  for (let h = 0; h < HORSE_COUNT; h++) {
    staticMods.push(mods(st, h))
    if (!st.horses[h]!.finished) running.push(h)
  }
  let limit = maxDt
  const field = [0n, 0n, 0n, 0n, 0n]
  const owners = wellOwners(st)
  if (owners.length > 0) {
    if (limit > RK_STEP_MS) limit = RK_STEP_MS
    st.steps++
    const start = st.horses.map((horse) => horse.pos)
    const p0 = fieldsAt(st, owners, start)
    const half = limit / 2n
    const mid = [...start]
    for (const h of running) {
      mid[h] = start[h]! + motionDelta(motionOf(st.horses[h]!, staticMods[h]!.pBps + p0[h]!), half)
    }
    const pm = fieldsAt(st, owners, mid)
    for (const h of running) field[h] = pm[h]!
  }
  const motions: PaidMotion[] = []
  let dt = limit
  for (const h of running) {
    const m = motionOf(st.horses[h]!, staticMods[h]!.pBps + field[h]!)
    motions[h] = m
    const need = crossingNeed(st, h, staticMods[h]!.airborne)
    if (motionDelta(m, dt) >= need) dt = firstReach(m, need, dt)
  }
  for (const h of running) {
    const horse = st.horses[h]!
    const m = motions[h]!
    const sm = staminaMotion(horse, staticMods[h]!)
    st.trace?.keyframes[h]!.push({
      tau0: tau, tau1: tau + dt, pos: horse.pos, dist: horse.dist, lane: horse.lane, finished: false,
      capMilli: horse.capMilli, pBps: staticMods[h]!.pBps + field[h]!, motion: m, stamina: sm,
    })
    const delta = motionDelta(m, dt)
    horse.prevPos = horse.pos
    horse.pos += delta
    horse.dist += delta
    const grown = horse.b + m.aEff * dt
    horse.b = grown > horse.capMilli ? horse.capMilli : grown
    horse.s = staminaAfter(sm, dt)
  }
  st.pending = []
  for (const h of running) {
    if (staticMods[h]!.airborne) continue
    const horse = st.horses[h]!
    for (let id = 0; id < st.bombs.length; id++) {
      const bomb = st.bombs[id]!
      if (!bomb.live || bomb.lane !== horse.lane || bomb.pos <= horse.prevPos || bomb.pos > horse.pos) continue
      if (horse.blindedPro && bomb.placer !== h) continue
      st.pending.push({ horse: h, bomb: id, done: false })
    }
  }
  return dt
}

function frozenFrame(st: State, h: number, tau: bigint): PaidTrace['keyframes'][number][number] {
  const horse = st.horses[h]!
  const m = mods(st, h)
  return {
    tau0: tau, tau1: tau, pos: horse.pos, dist: horse.dist, lane: horse.lane, finished: horse.finished,
    capMilli: horse.capMilli, pBps: m.pBps, motion: motionOf(horse, m.pBps), stamina: staminaMotion(horse, m),
  }
}

// ---------------------------------------------------------------- driver

function processMillisecond(st: State, tau: bigint, opts: PaidSolveOptions): PaidSolveStatus | null {
  for (;;) {
    const due = findDue(st, tau)
    if (due === null) return null
    if (opts.untilWall !== undefined && stampOf(st, due, tau) > opts.untilWall) return 'wall'
    applyDue(st, due, tau)
    if (st.stopPanel !== null) return 'panel'
  }
}

function tauLimit(st: State, untilWall: bigint): bigint {
  const span = untilWall - st.mapWall
  return st.mapTau + (st.mapSlow ? span / SLOW_FACTOR : span)
}

/**
 * Reference solver for paid ruleset v4; every rule quantity is an integer and every loop is bounded. Stored choices
 * never make it throw: only malformed input and the unreachable instance/bomb/event caps do.
 */
export function solvePaidCore(input: PaidCoreInput, opts: PaidSolveOptions = {}): PaidSolveResult {
  validateInput(input)
  if (opts.stopAtPanel !== undefined && ![1, 2, 3].includes(opts.stopAtPanel)) throw new Error('INVALID_OPTIONS')
  if (opts.untilWall !== undefined && (typeof opts.untilWall !== 'bigint' || opts.untilWall < 0n)) {
    throw new Error('INVALID_OPTIONS')
  }
  const st = createState(input, opts)
  let tau = 0n
  let status: PaidSolveStatus = 'complete'
  for (;;) {
    const stop = processMillisecond(st, tau, opts)
    if (stop !== null) {
      status = stop
      break
    }
    if (st.horses.every((horse) => horse.finished) || tau >= MAX_TAU) break
    let horizon = nextKnownTau(st, tau)
    if (opts.untilWall !== undefined) {
      const limit = tauLimit(st, opts.untilWall)
      if (limit <= tau) {
        status = 'wall'
        break
      }
      if (limit < horizon) horizon = limit
    }
    tau += advance(st, tau, horizon - tau)
  }
  if (status === 'complete') {
    // Choices the race never reached: a panel that never opened, or one still open when τ hit 600000 (the unfinished
    // player's finishWall = wall(600000) is before its txSec).
    for (let k = 1; k <= 3; k++) {
      if (st.input.choices[k - 1] === null) continue
      if (st.records[k - 1]!.mode === null) invalidChoice(st, k, tau, INVALID_NOT_OPENED)
      else if (st.panel?.k === k && st.panel.slot !== null) invalidChoice(st, k, tau, INVALID_AFTER_FINISH)
    }
  }
  return buildResult(st, status, tau)
}

const CHECK_ERRORS: Readonly<Record<number, string>> = {
  [INVALID_NOT_OPENED]: 'CHOICE_NOT_OPEN', [INVALID_EARLY]: 'CHOICE_NOT_OPEN', [INVALID_AUTO]: 'CHOICE_NOT_OPEN',
  [INVALID_CUT]: 'CHOICE_NOT_OPEN', [INVALID_LATE]: 'CHOICE_OUTSIDE_WINDOW', [INVALID_AFTER_FINISH]: 'CHOICE_AFTER_FINISH',
  [INVALID_NO_CREDIT]: 'NO_REFRESH_CREDIT', [INVALID_BAD_SLOT]: 'INVALID_REFRESH', [INVALID_EXHAUSTED]: 'DECK_EXHAUSTED',
  [INVALID_NOT_OFFERED]: 'CARD_NOT_OFFERED',
}

/**
 * Pre-send check for the browser: whether choices[k − 1] would take effect given only the earlier stored choices,
 * returning openSec. Throws when the panel is not open and manual at txSec (not reached yet, cut or auto), when txSec
 * is outside [openSec, openSec + 20), when the player finishes first, or when the refresh/card is illegal.
 */
export function checkPaidChoice(input: PaidCoreInput, checkpoint: 1 | 2 | 3): bigint {
  const slot = input.choices[checkpoint - 1]
  if (slot === null || slot === undefined) throw new Error('CHOICE_MISSING')
  for (let k = checkpoint + 1; k <= 3; k++) if (input.choices[k - 1] !== null) throw new Error('CHOICE_ORDER')
  const r = solvePaidCore(input, { untilWall: slot.txSec * 1000n, trace: false })
  const rec = r.checkpoints[checkpoint - 1]!
  if (rec.reason === 'picked' || rec.reason === 'forfeit-tx') return rec.openSec
  throw new Error(CHECK_ERRORS[rec.invalidReason] ?? 'CHOICE_NOT_OPEN')
}

export type PaidChoiceVerdict =
  | { valid: true; openSec: bigint; reason: null }
  | { valid: false; openSec: bigint; reason: PaidChoiceInvalidReason }

/**
 * Post-receipt verdict for the browser, never throwing for a rule-breaking choice: whether the stored choices[k − 1]
 * takes effect in the settlement solve, else the CHOICE_INVALID reason. Later choices cannot change it and are ignored.
 * openSec is the panel's opening second (0 when it never opened or was cut).
 */
export function classifyPaidChoice(input: PaidCoreInput, checkpoint: 1 | 2 | 3): PaidChoiceVerdict {
  const slot = input.choices[checkpoint - 1]
  if (slot === null || slot === undefined) throw new Error('CHOICE_MISSING')
  const choices = input.choices.map((c, i) => i < checkpoint ? c : null) as unknown as PaidChoiceSlots
  const rec = solvePaidCore({ ...input, choices }, { trace: false }).checkpoints[checkpoint - 1]!
  if (rec.invalidReason === 0) return { valid: true, openSec: rec.openSec, reason: null }
  return { valid: false, openSec: rec.openSec, reason: PAID_CHOICE_INVALID_NAMES[rec.invalidReason]! }
}

function buildResult(st: State, status: PaidSolveStatus, tau: bigint): PaidSolveResult {
  const finishTime = st.horses.map((horse) => horse.finished ? horse.finishTime : UNFINISHED_TAU)
  // A complete race stops at MAX_TAU, so a horse still running gets wall(600000); partial solves keep NEVER.
  const unfinishedWall = status === 'complete' ? wallAt(st, tau) : NEVER
  const finishWall = st.horses.map((horse) => horse.finished ? horse.finishWall : unfinishedWall)
  const settlement = paidSettlement(finishTime, st.player, st.acquired)
  const panel = status === 'panel' ? st.stopPanel : st.panel !== null ? panelState(st, st.panel) : null
  if (st.trace !== null) {
    st.trace.tauEnd = tau
    st.trace.events = st.events
    for (let h = 0; h < HORSE_COUNT; h++) if (!st.horses[h]!.finished) st.trace.keyframes[h]!.push(frozenFrame(st, h, tau))
  }
  return {
    status,
    ...(st.input.roster ? { roster: normalizeRoster(st.input.roster) } : {}),
    tauEnd: tau,
    wallEnd: wallAt(st, tau),
    panel,
    finishTime,
    finishWall,
    rawOrder: settlement.rawOrder,
    settlementOrder: settlement.settlementOrder,
    rawRank: settlement.rawRank,
    settlementRank: settlement.settlementRank,
    versionAnswer: settlement.versionAnswer,
    acquired: [...st.acquired],
    acquiredByCheckpoint: st.records.map((rec) => rec.cardId),
    checkpoints: st.records.map((rec) => ({ ...rec, candidates: [...rec.candidates] })),
    eventCount: st.events.length,
    digest: st.digest,
    stepCount: st.steps,
    events: st.events,
    trace: st.trace,
  }
}
