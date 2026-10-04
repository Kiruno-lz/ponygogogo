import { normalizeRoster } from './core/roster.ts'
/**
 * 共享求时器轨迹 → 表现层快照。RaceScreen / RaceScene / Hud 使用 `RaceState` 与 `RaceEvent`，
 * 这里把 P2 求时器的渲染轨迹（µu、mu/s、µ体力、模拟毫秒）按固定比例换成同一套字段，表现层一行不改。
 *
 * 单位换算（两边赛道都是 100000 单位）：
 * - 位置/里程：Demo 定点 `TRACK_LEN = 100000·FP`，有奖 `10¹¹ µu` → demo = µu / 100。
 * - 速度：Demo 是「单位/tick（20 ms）」的定点值，有奖是 mu/s → demo = mu/s · FP / (1000 · 50) = mu/s / 5。
 * - 体力：Demo 满值 `fx(1000) = 10⁷`，有奖容量 `10⁹` → demo = µ体力 / 100。
 * - 时间：tick = τ / 20（ms），HUD 的剩余秒数与名次榜冲线时间都按 SIM_HZ = 50 读回。
 *
 * 规则事实只来自求时器：这里不做任何速度、体力或名次计算。
 */
import type { PaidDrawState } from './core/paidDrawRules.ts'
import { STAMINA_MAX } from './core/constants.ts'
import { FP } from './core/fixed.ts'
import type { EffectInstance, EquipSlot, HorseState, PendingChoice, RaceEvent, RaceState } from './core/types.ts'
import { PAID_RULESET_HASH, LEGACY_PAID_RULESET_HASH, PAID_CARD_COUNT, paidCardRule } from './paid/cardRules.ts'
import { ponyRule } from './paid/ponyRules.ts'
import {
  EV_EQUIP_REFRESH, EV_GUARD, EV_RESOURCE, EV_TRIGGER, EV_FIXED, EV_TARGET, EV_BOMB_EXPLODE, EV_BOMB_PLACE, EV_CARD, EV_CHECKPOINT, EV_DEATH, EV_EQUIP_OFF, EV_EQUIP_ON, EV_EXHAUST_ENTER,
  EV_EXHAUST_EXIT, EV_FINISH, EV_RESPAWN_END, EV_STEAL, EV_SWAP, EV_WIND, EV_PONY, type PaidLoggedEvent,
} from './paid/events.ts'
import { bombsAt, sampleHorse, windAt, type PaidTrace, type PaidTraceInstance } from './paid/trace.ts'

export const MICRO_PER_DEMO = 100n
export const TICK_MS = 20n

export function paidCardKey(cardId: number): string {
  return `C-${String(cardId).padStart(2, '0')}`
}

export function paidCardNumber(key: string | null): number | null {
  if (key === null) return null
  const m = /^C-(\d{2})$/.exec(key)
  if (!m) return null
  const id = Number(m[1])
  return id >= 1 && id <= PAID_CARD_COUNT ? id : null
}

export function demoPos(micro: bigint): number {
  return Number(micro / MICRO_PER_DEMO)
}

export function demoSpeed(muPerSec: bigint): number {
  return Number(muPerSec * BigInt(FP) / 50_000n)
}

export function demoStamina(micro: bigint): number {
  return Number(micro * BigInt(STAMINA_MAX) / 1_000_000_000n)
}

export function tickOf(tau: bigint): number {
  return Number(tau / TICK_MS)
}

/** 装备 cardId → RaceScene 的装备贴图键（src/game/effects.ts）与槽位 */
const EQUIP_VISUAL: Record<number, { equipId: string; slot: EquipSlot }> = {
  7: { equipId: 'rocket', slot: 'torso' },
  8: { equipId: 'rainbowTrail', slot: 'tail' },
  10: { equipId: 'blackhole', slot: 'torso' },
  11: { equipId: 'fireWheel', slot: 'hoof_fl' },
}

function ticks(ms: bigint | null): number | null {
  return ms === null ? null : Number(ms / TICK_MS)
}

function effectFrom(inst: PaidTraceInstance, trace: PaidTrace, tau: bigint): EffectInstance[] {
  let deadline = inst.plannedEndTau
  for (const renewal of trace.renewals) if (renewal.instanceId === inst.id && renewal.tau <= tau) deadline = renewal.end
  const base = {
    instanceId: inst.id,
    ownerHorseId: inst.horse,
    appliedAtTick: tickOf(inst.startTau),
    durationTicks: ticks(deadline === null ? null : deadline - inst.startTau),
  }
  if (inst.kind === 'respawn') {
    return [{
      ...base, sourceCardId: 'system.death', primitive: 'Status', moduleId: 'paid', tags: ['debuff'],
      payload: { statusId: 'respawning' },
    }]
  }
  if (inst.ponyId !== undefined) return [{ ...base, sourceCardId: `pony:${inst.ponyId}:${inst.id}`, primitive: 'Modifier',
    moduleId: 'paid', tags: ['buff'], payload: { ponyId: inst.ponyId, percentBps: Number(inst.initialP) } }]
  if (inst.cardId <= 0) return []
  const key = paidCardKey(inst.cardId)
  const effect = paidCardRule(inst.cardId).effect
  if (inst.kind === 'equip') {
    const visual = EQUIP_VISUAL[inst.cardId]
    const out: EffectInstance[] = [{
      ...base, sourceCardId: key, primitive: 'Equipment', moduleId: 'paid', tags: ['equipment'],
      payload: visual ? { equipId: visual.equipId, slot: visual.slot } : {},
    }]
    if (effect === 'wheel') {
      out.push({ ...base, instanceId: -inst.id, sourceCardId: key, primitive: 'Status', moduleId: 'paid', tags: ['buff'], payload: { statusId: 'airborne' } })
    }
    return out
  }
  if (inst.kind === 'ability') {
    return [{ ...base, sourceCardId: key, primitive: 'Ability', moduleId: 'paid', tags: ['buff'], payload: { abilityId: 'clapSwap' } }]
  }
  if (inst.kind === 'bonus') return []
  if (inst.kind === 'watch') {
    const count = trace.events.filter(e => e.code === EV_TRIGGER && e.horse === inst.horse && e.tau <= tau && e.arg / 256n === BigInt(inst.cardId)).at(-1)?.arg ?? 0n
    return [{ ...base, sourceCardId: key, primitive: 'Modifier', moduleId: 'paid', tags: ['buff'], payload: { stacks: Number(count % 256n), waiting: true } }]
  }
  const statusId = effect === 'speedDeath' ? 'luckE' : effect === 'airborneSpeed' ? 'airborne' : effect === 'wired' ? 'wired' : undefined
  return [{
    ...base, sourceCardId: key, primitive: statusId ? 'Status' : 'Modifier', moduleId: 'paid',
    tags: effect === 'speedDeath' ? ['buff', 'debuff'] : inst.initialP < 0 ? ['debuff'] : ['buff'],
    payload: effect === 'speedDeath' ? { statusId: 'luckE', spin: true } : statusId ? { statusId } : {},
  }]
}

function coatCss(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

/** τ 时刻生效的全部效果（含永久卡、力竭与环境风），按表现层的 EffectInstance 形状。 */
export function effectsAt(trace: PaidTrace, tau: bigint, exhausted: readonly boolean[]): { effects: EffectInstance[]; env: EffectInstance | null } {
  const effects: EffectInstance[] = []
  for (const inst of trace.instances) {
    if (inst.startTau > tau || (inst.endTau !== null && tau >= inst.endTau)) continue
    effects.push(...effectFrom(inst, trace, tau))
  }
  const latestCoats = new Map<number, typeof trace.cards[number]>()
  for (const card of trace.cards) if (card.tau <= tau && paidCardRule(card.cardId).effect === 'coat') latestCoats.set(card.horse, card)
  let permanentId = 100_000
  for (const card of trace.cards) {
    if (card.tau > tau) continue
    const rule = paidCardRule(card.cardId)
    if (rule.effect === 'coat' && latestCoats.get(card.horse) !== card) continue
    const payload = rule.effect === 'coat' ? { statusId: 'coat' as const, coat: coatCss(rule.coatRgb!) }
      : rule.effect === 'blindFixed' ? { statusId: 'blindedPro' as const }
        : rule.effect === 'fixed' || rule.effect === 'refresh' || rule.effect === 'drawAuto' ? {}
          : null
    if (payload === null) continue
    effects.push({
      instanceId: permanentId++, sourceCardId: paidCardKey(card.cardId), primitive: 'statusId' in payload ? 'Status' : 'Modifier',
      moduleId: 'paid', ownerHorseId: card.horse, appliedAtTick: tickOf(card.tau), durationTicks: null, tags: ['buff'], payload,
    })
  }
  exhausted.forEach((ex, h) => {
    if (!ex) return
    effects.push({
      instanceId: 200_000 + h, sourceCardId: 'system.exhaust', primitive: 'Status', moduleId: 'paid', ownerHorseId: h,
      appliedAtTick: tickOf(tau), durationTicks: null, tags: ['debuff'], payload: { statusId: 'exhausted' },
    })
  })
  const wind = windAt(trace, tau)
  let env: EffectInstance | null = null
  if (wind !== null) {
    env = {
      instanceId: 300_000, sourceCardId: paidCardKey(12), primitive: 'Environment', moduleId: 'paid', ownerHorseId: -1,
      appliedAtTick: tickOf(wind.tau), durationTicks: null, tags: ['env'],
      payload: { envKind: 'wind', windDir: wind.bps < 0n ? -1 : 1 },
    }
    effects.push(env)
  }
  return { effects, env }
}

/** 当前要给玩家看的选牌面板；null = 没有面板（或点击后已收起、慢放仍在继续）。 */
export type PaidPanelView = {
  checkpoint: 1 | 2 | 3
  mode: 'manual' | 'auto'
  candidates: number[]
  refreshSlots: number[]
  refreshCredits: number
  openTau: bigint
}

export type SnapshotInput = {
  roster?: readonly number[]
  trace: PaidTrace
  tau: bigint
  playerHorseId: number
  stakeTier: number
  seed: string
  /** 平滑校正：每匹马在 demo 位置单位上的临时偏移 */
  posOffset?: readonly number[]
  panel: PaidPanelView | null
  draw: PaidDrawState | null
  playerDeck: readonly number[]
  finishTime: readonly bigint[]
  raceOver: boolean
  versionAnswer?: boolean
}

/** 冲线名次：按 (finishTime, horseId) 在已冲线的马里排序。 */
export function finishRanks(finishTime: readonly bigint[], tau: bigint): number[] {
  const done = finishTime.map((t, h) => ({ t, h })).filter((x) => x.t <= tau)
  done.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.h - b.h))
  const ranks = [0, 0, 0, 0, 0]
  done.forEach((x, i) => { ranks[x.h] = i + 1 })
  return ranks
}

export function buildPaidSnapshot(input: SnapshotInput): RaceState {
  const { trace, tau, playerHorseId } = input
  const samples = [0, 1, 2, 3, 4].map((h) => sampleHorse(trace, h, tau))
  const ranks = finishRanks(input.finishTime, tau)
  const horses: HorseState[] = samples.map((s, h) => ({
    horseId: h,
    laneIndex: s.lane,
    isPlayer: h === playerHorseId,
    pos: demoPos(s.pos) + (input.posOffset?.[h] ?? 0),
    dist: demoPos(s.dist),
    v: demoSpeed(s.v),
    stamina: demoStamina(s.stamina),
    marksConsumed: 0,
    finished: s.finished,
    finishTick: s.finished ? tickOf(input.finishTime[h]!) : 0,
    finishOvershoot: 0,
    rank: ranks[h]!,
    deathRecover: false,
    fieldMul: 0,
    cpu: null,
    cpuTarget: 0,
    bandLow: 0,
    bandHigh: 0,
  }))
  const { effects, env } = effectsAt(trace, tau, samples.map((s) => s.exhausted))
  const hazards = bombsAt(trace, tau).map((b) => ({
    hazardId: b.id, laneIndex: b.lane, pos: demoPos(b.pos), sourceCardId: paidCardKey(6),
  }))
  const panel = input.panel
  const pending: PendingChoice | null = panel === null ? null : {
    checkpoint: (panel.checkpoint - 1) as 0 | 1 | 2,
    candidates: panel.candidates.map(paidCardKey),
    slotSources: [],
    openedAtTick: tickOf(panel.openTau),
    refreshesUsed: [...panel.refreshSlots],
  }
  const playerFinished = samples[playerHorseId]!.finished
  const finishedOrder = [0, 1, 2, 3, 4].filter((h) => ranks[h]! > 0).sort((a, b) => ranks[a]! - ranks[b]!)
  const draw = input.draw
  return {
    seed: input.seed,
    ...(input.roster ? { roster: normalizeRoster(input.roster) } : {}),
    rulesVersion: input.roster ? PAID_RULESET_HASH : LEGACY_PAID_RULESET_HASH,
    tick: tickOf(tau),
    stakeTier: input.stakeTier,
    playerHorseId,
    horses,
    effects,
    nextInstanceId: 0,
    env,
    hazards,
    nextHazardId: hazards.length,
    deck: input.playerDeck.map(paidCardKey),
    cursor: draw?.cursor ?? 0,
    refreshCredits: panel?.refreshCredits ?? draw?.refreshCredits ?? 0,
    drawMode: panel?.mode === 'auto' || draw?.automatic ? 'auto' : draw?.forfeited ? 'cut' : 'manual',
    drawBonusPct: 0,
    pending,
    choices: [],
    gogoClicks: [],
    abilityBinding: null,
    abilityHeld: false,
    cpuDecks: {},
    cpuDeckCursor: {},
    finishedOrder,
    forcedRank: input.versionAnswer ? { horseId: playerHorseId, rank: 1 } : null,
    endReason: input.raceOver ? 'finished' : null,
    playerFinished,
    raceOver: input.raceOver,
    lastClickTick: 0,
    lastIntervalMs: 0,
    fHat: 0,
    swapIndex: 0,
    windIndex: 0,
    stealIndex: 0,
    autopickIndex: 0,
    events: [],
  }
}

/**
 * 求时器事件 → 表现层事件。只翻译画面与音效用得到的那几类；其余（体力阈值、面板开关等）
 * 由快照本身体现。`ranks` 是冲线事件那一刻的名次。
 */
export function toRaceEvent(e: PaidLoggedEvent, trace: PaidTrace, playerHorseId: number, finishTime: readonly bigint[]): RaceEvent | null {
  const tick = tickOf(e.tau)
  switch (e.code) {
    case EV_FINISH: return { type: 'finish', horseId: e.horse, rank: finishRanks(finishTime, e.tau)[e.horse] || 0, tick }
    case EV_CHECKPOINT: return { type: 'checkpoint', horseId: e.horse, mark: Number(e.arg), tick }
    case EV_CARD: return e.horse === playerHorseId ? { type: 'cardPicked', horseId: e.horse, cardId: paidCardKey(Number(e.arg)), tick } : null
    case EV_BOMB_PLACE: return { type: 'hazardPlaced', laneIndex: Number(e.arg % 8n), pos: demoPos(e.arg / 8n), tick }
    case EV_BOMB_EXPLODE: {
      const bomb = trace.bombs[Number(e.arg)]
      return bomb ? { type: 'explosion', laneIndex: bomb.lane, pos: demoPos(bomb.pos), horseId: e.horse, tick } : null
    }
    case EV_DEATH: return { type: 'death', horseId: e.horse, tick }
    case EV_RESPAWN_END: return { type: 'respawnEnd', horseId: e.horse, tick }
    case EV_SWAP: return { type: 'swap', a: e.horse, b: Number(e.arg % 8n), tick }
    case EV_EQUIP_ON: case EV_EQUIP_OFF: {
      const id = e.code === EV_EQUIP_ON ? Number(e.arg) : Number(e.arg / 4n)
      const inst = trace.instances[id - 1]
      const visual = inst ? EQUIP_VISUAL[inst.cardId] : undefined
      if (!visual) return null
      return { type: e.code === EV_EQUIP_ON ? 'equipOn' : 'equipOff', horseId: e.horse, equipId: visual.equipId, slot: visual.slot, tick }
    }
    case EV_STEAL: {
      const loot = trace.instances[Number(e.arg) - 1]
      const visual = loot ? EQUIP_VISUAL[loot.cardId] : undefined
      return loot && visual ? { type: 'steal', from: loot.horse, to: e.horse, equipId: visual.equipId, tick } : null
    }
    case EV_EXHAUST_ENTER: return { type: 'exhaustEnter', horseId: e.horse, tick }
    case EV_EXHAUST_EXIT: return { type: 'exhaustExit', horseId: e.horse, tick }
    case EV_TRIGGER: return { type: 'cardEffect', horseId: e.horse, cardId: paidCardKey(Number(e.arg / 256n)), kind: 'trigger', value: Number(e.arg % 256n), tick }
    case EV_PONY: {
      const ponyId = Number(e.arg / 65536n)
      return { type: 'cardEffect', horseId: e.horse, ponyId, kind: 'pony', value: (ponyRule(ponyId).bonusBps ?? 0) / 100, tick }
    }
    case EV_RESOURCE: return { type: 'cardEffect', horseId: e.horse, kind: 'resource', value: Number(e.arg) / 1e6, tick }
    case EV_FIXED: return { type: 'cardEffect', horseId: e.horse, kind: 'fixed', value: Number(e.arg), tick }
    case EV_TARGET: return { type: 'cardEffect', horseId: e.horse, cardId: 'C-34', kind: 'target', value: Number(e.arg), tick }
    case EV_GUARD: return { type: 'cardEffect', horseId: e.horse, cardId: 'C-37', kind: 'guard', value: 1, tick }
    case EV_EQUIP_REFRESH: return { type: 'cardEffect', horseId: e.horse, cardId: 'C-32', kind: 'renew', value: Number(e.arg), tick }
    case EV_WIND: return { type: 'wind', dir: e.arg < 0n ? -1 : 1, tick }
    default: return null
  }
}

/**
 * 按现实时间切出本帧该发的事件。事件以「(code, horse, 第几次)」为键去重：重解后同一件事的 τ 可能挪了
 * 几毫秒，但不会被当成新事件再播一遍；重解后才出现在已播放时段里的新事件会补发（晚到，但不丢）。
 * 早于 `replayFloorWall` 的事件只记为已播放、不补发（恢复进场时不回放整场）。
 */
export function eventsUpTo(
  events: readonly PaidLoggedEvent[], wall: bigint, emitted: Set<string>, replayFloorWall: bigint,
): PaidLoggedEvent[] {
  const seen = new Map<string, number>()
  const out: PaidLoggedEvent[] = []
  for (const e of events) {
    if (e.wall > wall) break
    const base = `${e.code}:${e.horse}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const key = `${base}:${n}`
    if (emitted.has(key)) continue
    emitted.add(key)
    if (e.wall >= replayFloorWall) out.push(e)
  }
  return out
}

/** 开场交易入块之前的画面：五匹马在起跑线上，赛道站位 = horseId。 */
export function idlePaidState(playerHorseId: number, stakeTier: number, roster?: readonly number[]): RaceState {
  const horses: HorseState[] = [0, 1, 2, 3, 4].map((h) => ({
    horseId: h, laneIndex: h, isPlayer: h === playerHorseId, pos: 0, dist: 0, v: 0, stamina: STAMINA_MAX,
    marksConsumed: 0, finished: false, finishTick: 0, finishOvershoot: 0, rank: 0, deathRecover: false, fieldMul: 0,
    cpu: null, cpuTarget: 0, bandLow: 0, bandHigh: 0,
  }))
  return {
    seed: '', rulesVersion: roster ? PAID_RULESET_HASH : LEGACY_PAID_RULESET_HASH, tick: 0, stakeTier, playerHorseId, horses, effects: [], nextInstanceId: 0,
    ...(roster ? { roster: normalizeRoster(roster) } : {}),
    env: null, hazards: [], nextHazardId: 0, deck: [], cursor: 0, refreshCredits: 0, drawMode: 'manual', drawBonusPct: 0,
    pending: null, choices: [], gogoClicks: [], abilityBinding: null, abilityHeld: false, cpuDecks: {}, cpuDeckCursor: {},
    finishedOrder: [], forcedRank: null, endReason: null, playerFinished: false, raceOver: false, lastClickTick: 0,
    lastIntervalMs: 0, fHat: 0, swapIndex: 0, windIndex: 0, stealIndex: 0, autopickIndex: 0, events: [],
  }
}
