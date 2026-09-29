import type { Hex } from 'viem'
import { chainEntropy } from '../core/chainEntropy.ts'
import {
  applyPaidChoice, classifyPaidDraw, initialPaidDrawState, resolvePaidAutomaticChoice, type PaidDrawState,
} from '../core/paidDrawRules.ts'
import { paidSettlement } from '../core/paidSettlement.ts'
import { paidSwap } from '../core/paidSwap.ts'
import { paidCardRule } from './cardRules.ts'
import {
  ADRENALINE_MICRO, AUTO_PANEL_SEC, bonusDurationMs, BONUS_BPS, CHECKPOINT_MICRO, CHOICE_WINDOW_SEC,
  COST_PER_MS, HORSE_COUNT, MAX_BOMBS, MAX_EVENTS, MAX_INSTANCES, MAX_TAU, NEVER, PURPOSE_STEAL, PURPOSE_WIND,
  REGEN_PER_MS, RESPAWN_MS, RK_STEP_MS, ROCKET_COST_PER_MS, SLOT_HOOVES, SLOT_TORSO, SLOW_FACTOR,
  STAMINA_CAPACITY, SWAP_ATTEMPTS, SWAP_EVENT_STRIDE, SWAP_PERIOD_MS, TRACK_MICRO, UNFINISHED_TAU, WHEEL_BURSTS,
  WHEEL_DELTA_V, WHEEL_PERIOD_MS, WIND_BPS, BPS,
} from './constants.ts'
import {
  CLOSE_AUTO, CLOSE_FINISHED, CLOSE_FORFEIT_TX, CLOSE_PICKED, CLOSE_TIMEOUT, EV_BASE_CAP, EV_BOMB_EXPLODE,
  EV_BOMB_PLACE, EV_CARD, EV_CHECKPOINT, EV_CHOICE_INVALID, EV_CPU_CARD_CUT, EV_DEATH, EV_DEATH_IMMUNE, EV_EQUIP_OFF,
  EV_EQUIP_ON, EV_EXHAUST_ENTER, EV_EXHAUST_EXIT, EV_EXPIRE, EV_FINISH, EV_OVERCAP_END, EV_PANEL_AUTO, EV_PANEL_CLOSE,
  EV_PANEL_CUT, EV_PANEL_DEFER, EV_PANEL_OPEN, EV_RESPAWN_END, EV_STEAL, EV_STEAL_NONE, EV_SWAP, EV_SWAP_BLOCKED,
  EV_WHEEL_BURST, EV_WIND, foldPaidEvent, INVALID_AFTER_FINISH, INVALID_AUTO, INVALID_BAD_SLOT, INVALID_CUT,
  INVALID_EARLY, INVALID_EXHAUSTED, INVALID_LATE, INVALID_NO_CREDIT, INVALID_NOT_OFFERED, INVALID_NOT_OPENED,
  OFF_EXPIRED, OFF_REPLACED, OFF_STOLEN, PAID_CHOICE_INVALID_NAMES, ZERO_DIGEST, type PaidChoiceInvalidReason,
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
 * (txSec uint32, cardId and refresh slots uint8); a slot that breaks a rule counts as no transaction (有奖规则 v3).
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
}

type Instance = {
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
  halfCost: boolean
  luck: boolean
  well: boolean
  anchor: Hex
  checkpoint: number
  eventBase: bigint
  count: number
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
  return typeof id === 'number' && Number.isInteger(id) && id >= (allowZero ? 0 : 1) && id <= 26
}

function isUint8(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

function validateInput(input: PaidCoreInput): void {
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
    horses.push({
      base: p.base, accel: p.acceleration, capMilli: p.cap * 1000n,
      pos: 0n, dist: 0n, prevPos: 0n, b: p.base * 1000n, s: STAMINA_CAPACITY, fixed: 0n, lane: h, cp: 0,
      exhausted: false, overcap: false, atCap: false, finished: false, finishTime: UNFINISHED_TAU, finishWall: NEVER,
      blindedPro: false, drawCut: false, bonus: false, equip: [0, 0, 0],
    })
  }
  const trace: PaidTrace | null = opts.trace === false ? null : {
    tauEnd: 0n, keyframes: [[], [], [], [], []], instances: [], bombs: [], winds: [], cards: [],
    segments: [{ tau: 0n, wall: 0n, slow: false }], events: [],
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
  let pBps = 0n
  let regenBps = 0n
  let halfCost = false
  let airborne = false
  let wired = false
  let respawning = false
  for (const inst of st.instances) {
    if (!inst.active || inst.owner !== h) continue
    pBps += inst.pBps
    regenBps += inst.regenBps
    halfCost = halfCost || inst.halfCost
    airborne = airborne || inst.airborne
    wired = wired || inst.wired
    respawning = respawning || inst.kind === 'respawn'
  }
  const horse = st.horses[h]!
  if (st.wind !== 0n && airborne && (!horse.blindedPro || st.windPlacer === h)) pBps += st.wind
  return {
    pBps,
    cost: halfCost ? ROCKET_COST_PER_MS : COST_PER_MS,
    regen: REGEN_PER_MS * (BPS + regenBps) / BPS,
    airborne,
    wired,
    respawning,
  }
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
    pBps: 0n, regenBps: 0n, airborne: false, wired: false, halfCost: false, luck: false, well: false,
    anchor: ZERO_ANCHOR, checkpoint: 0, eventBase: 0n, count: 0, ...fields,
  }
  st.instances.push(inst)
  st.trace?.instances.push({
    id: inst.id, horse: owner, cardId, kind, slot: inst.slot, startTau: tau,
    plannedEndTau: duration === null ? null : inst.end, endTau: null, endReason: null,
  })
  return inst
}

function endInstance(st: State, inst: Instance, tau: bigint, reason: PaidInstanceEnd): void {
  inst.active = false
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
    if (inst.kind === 'ability' && inst.count < SWAP_ATTEMPTS
      && inst.start + SWAP_PERIOD_MS * BigInt(inst.count) === tau) return { cls: 4, id: inst.id }
    if (inst.kind === 'equip' && inst.cardId === 11 && inst.count < WHEEL_BURSTS
      && inst.start + WHEEL_PERIOD_MS * BigInt(inst.count + 1) === tau) return { cls: 4, id: inst.id }
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
  if (mods(st, h).respawning) {
    emit(st, EV_DEATH_IMMUNE, tau, h, 0n)
    return
  }
  const horse = st.horses[h]!
  horse.b = 0n
  horse.fixed = 0n
  horse.atCap = false
  const respawn = addInstance(st, tau, h, 0, 'respawn', RESPAWN_MS)
  emit(st, EV_DEATH, tau, h, BigInt(respawn.id))
}

type EquipSpec = { slot: number; duration: bigint; fields: Partial<Instance> }

function equipSpec(cardId: number): EquipSpec {
  const rule = paidCardRule(cardId)
  const duration = BigInt(rule.durationMs!)
  switch (rule.effect) {
    case 'rocket': return { slot: rule.slot!, duration, fields: { pBps: BigInt(rule.pBps!), halfCost: true } }
    case 'rainbow': return { slot: rule.slot!, duration, fields: { pBps: BigInt(rule.pBps!) } }
    case 'gravity': return { slot: rule.slot!, duration, fields: { well: true } }
    case 'wheel': return { slot: rule.slot!, duration, fields: { airborne: true } }
    default: throw new Error('NOT_EQUIPMENT')
  }
}

function equip(st: State, h: number, cardId: number, tau: bigint): bigint {
  const spec = equipSpec(cardId)
  const horse = st.horses[h]!
  const oldId = horse.equip[spec.slot]!
  if (oldId !== 0) {
    endInstance(st, st.instances[oldId - 1]!, tau, 'replaced')
    emit(st, EV_EQUIP_OFF, tau, h, BigInt(oldId) * 4n + BigInt(OFF_REPLACED))
  }
  const inst = addInstance(st, tau, h, cardId, 'equip', spec.duration, { ...spec.fields, slot: spec.slot })
  horse.equip[spec.slot] = inst.id
  emit(st, EV_EQUIP_ON, tau, h, BigInt(inst.id))
  return spec.duration
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
  return equip(st, h, loot.cardId, tau)
}

function applyCard(st: State, h: number, cardId: number, src: CardSource, tau: bigint): void {
  const horse = st.horses[h]!
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
    case 'fixed': horse.fixed += BigInt(rule.fixedSpeed!); break
    case 'blindFixed':
      horse.fixed += BigInt(rule.fixedSpeed!)
      horse.blindedPro = true
      break
    default: break
  }
  if (horse.bonus) addInstance(st, tau, h, cardId, 'bonus', bonusDurationMs(cardId, lootMs), { pBps: BONUS_BPS })
  if (rule.effect === 'drawAuto') horse.bonus = true
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

/** 有奖规则 v3: the stored choice for checkpoint k is ignored; the checkpoint proceeds as without a transaction. */
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
      else {
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
    if (inst.kind === 'ability' && inst.count < SWAP_ATTEMPTS) {
      const at = inst.start + SWAP_PERIOD_MS * BigInt(inst.count)
      if (at < next) next = at
    }
    if (inst.kind === 'equip' && inst.cardId === 11 && inst.count < WHEEL_BURSTS) {
      const at = inst.start + WHEEL_PERIOD_MS * BigInt(inst.count + 1)
      if (at < next) next = at
    }
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
 * Reference solver for paid ruleset v3; every rule quantity is an integer and every loop is bounded. Stored choices
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
