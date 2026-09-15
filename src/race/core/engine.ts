/**
 * 规则骨架。卡池为空时它仍然要能独立跑完一整场五匹马的比赛。
 *
 * tick 内的固定阶段顺序（该顺序是 rulesVersion 的组成部分）：
 *   超时 → 输入（onInputIntent）→ 效果更新（onEffectApply / onEffectExpire）
 *        → 模块速度贡献（contributeSpeed / contributeStamina）
 *        → 电脑马目标速度 → 外部场与环境乘子、全局 clamp → 体力与速度
 *        → 位移 → 场与实体结算 → 位置跳变 → 里程与终点 → 发牌
 *
 * 本文件不 import 任何渲染、DOM、链或浏览器 API。
 */
import { CARD_BY_ID } from '../cards/pool.ts'
import { deriveCpuParamSets } from '../cpu/params.ts'
import {
  A_IDLE,
  A_MAX,
  ABILITY_FHAT,
  CARDS_PER_CHECKPOINT,
  CHECKPOINT_MARKS,
  DEATH_RECOVER_ACCEL,
  DECK_SIZE,
  EXHAUST_RELEASE,
  HORSE_COUNT,
  PLAYER_V_HIGH,
  PLAYER_V_LOW,
  RHYTHM_MIN_INTERVAL_MS,
  RHYTHM_TARGET_MS,
  RHYTHM_WINDOW_MS,
  RULES_VERSION,
  STAMINA_COST_FACTOR,
  STAMINA_MAX,
  STAMINA_REGEN,
  TICK_MS,
  TRACK_LEN,
  V_HARD_MAX,
} from './constants.ts'
import { deriveCpuDeck, deriveDeck } from './deck.ts'
import { FP, clamp, divFx, fx, mulFx, type Fixed } from './fixed.ts'
import type { DrawRequest, ModuleCtx, MutationAPI, RaceModule, WriteScope } from './module.ts'
import { modulesFingerprint, orderModules } from './module.ts'
import { aggregate, applyPipeline, sortContribs } from './pipeline.ts'
import { H, hRange } from './rng.ts'
import type {
  AbilityBinding,
  ChoiceRecord,
  EffectInstance,
  EffectTag,
  EquipSlot,
  Hazard,
  HorseState,
  ModifierContribution,
  RaceEvent,
  RaceInput,
  RaceState,
  StatusId,
} from './types.ts'

export interface RaceConfig {
  seed: string
  playerHorseId: number
  stakeTier: number
  /** 仅测试可见：注入式牌堆，绕过 seed 发牌 */
  injectDeck?: string[]
  injectCpuDecks?: Record<number, string[]>
}

/** 写权限矩阵：docs/architecture/effect-system.md §4.2 */
const WRITE_MATRIX: Record<WriteScope, string[]> = {
  speed: ['mod.death', 'mod.swap', 'mod.hazard'],
  pos: ['mod.death', 'mod.swap', 'mod.hazard'],
  lane: ['mod.swap'],
  field: ['mod.field', 'mod.env'],
  equipment: ['mod.steal', 'mod.equipment'],
  env: ['mod.env'],
  forcedRank: ['mod.combo'],
  removeByTag: ['mod.suppress', 'mod.steal', 'mod.equipment', 'mod.ability-bind', 'mod.cosmetic', 'mod.env'],
  deckCursor: ['mod.draw'],
  hazard: ['mod.hazard'],
  abilityBind: ['mod.ability-bind'],
  stamina: ['mod.stamina'],
  status: ['mod.airborne', 'mod.stack', 'mod.death', 'mod.cosmetic', 'mod.suppress', 'mod.trail', 'mod.trigger'],
}

export class RaceEngine {
  readonly state: RaceState
  private readonly modules: RaceModule[]
  private readonly moduleById = new Map<string, RaceModule>()
  readonly mut: MutationAPI
  /** 每匹马的装备插槽 -> 效果实例 id */
  readonly equipSlots = new Map<number, Map<EquipSlot, number>>()
  /** 本 tick 收集的乘区贡献 */
  private contribCache: ModifierContribution[] = []

  constructor(cfg: RaceConfig, modules: RaceModule[]) {
    this.modules = orderModules(modules)
    for (const m of this.modules) this.moduleById.set(m.id, m)

    const paramSets = deriveCpuParamSets(cfg.seed, cfg.stakeTier)
    const cpuIds = Array.from({ length: HORSE_COUNT }, (_, i) => i).filter((id) => id !== cfg.playerHorseId)

    const horses: HorseState[] = []
    for (let id = 0; id < HORSE_COUNT; id++) {
      const isPlayer = id === cfg.playerHorseId
      const cpuIdx = cpuIds.indexOf(id)
      horses.push({
        horseId: id,
        laneIndex: id,
        isPlayer,
        pos: 0,
        dist: 0,
        v: 0,
        stamina: STAMINA_MAX,
        marksConsumed: 0,
        finished: false,
        finishTick: -1,
        finishOvershoot: 0,
        rank: 0,
        deathRecover: false,
        fieldMul: 0,
        cpu: isPlayer ? null : paramSets[cpuIdx]!,
        cpuTarget: isPlayer ? 0 : paramSets[cpuIdx]!.base,
        bandLow: isPlayer ? PLAYER_V_LOW : 0,
        bandHigh: isPlayer ? PLAYER_V_HIGH : 0,
      })
      this.equipSlots.set(id, new Map())
    }

    const cpuDecks: Record<number, string[]> = {}
    const cpuCursor: Record<number, number> = {}
    for (const id of cpuIds) {
      cpuDecks[id] = cfg.injectCpuDecks?.[id] ?? deriveCpuDeck(cfg.seed, id)
      cpuCursor[id] = 0
    }

    this.state = {
      seed: cfg.seed,
      rulesVersion: RULES_VERSION + '|' + modulesFingerprint(this.modules),
      tick: 0,
      stakeTier: cfg.stakeTier,
      playerHorseId: cfg.playerHorseId,
      horses,
      effects: [],
      nextInstanceId: 1,
      env: null,
      hazards: [],
      nextHazardId: 1,
      deck: cfg.injectDeck ? [...cfg.injectDeck] : deriveDeck(cfg.seed),
      cursor: 0,
      refreshCredits: 0,
      drawMode: 'manual',
      drawBonusPct: 0,
      pending: null,
      choices: [],
      gogoClicks: [],
      abilityBinding: null,
      abilityHeld: false,
      cpuDecks,
      cpuDeckCursor: cpuCursor,
      finishedOrder: [],
      forcedRank: null,
      endReason: null,
      playerFinished: false,
      raceOver: false,
      lastClickTick: -1,
      lastIntervalMs: -1,
      fHat: 0,
      swapIndex: 0,
      windIndex: 0,
      stealIndex: 0,
      autopickIndex: 0,
      events: [],
    }

    this.mut = this.makeMutationAPI()
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  horseById(id: number): HorseState {
    const h = this.state.horses[id]
    if (!h) throw new Error('unknown horseId ' + id)
    return h
  }

  player(): HorseState {
    return this.horseById(this.state.playerHorseId)
  }

  effectsOf(horseId: number): EffectInstance[] {
    return this.state.effects.filter((e) => e.ownerHorseId === horseId)
  }

  hasStatus(horseId: number, statusId: StatusId): boolean {
    return this.state.effects.some(
      (e) => e.ownerHorseId === horseId && e.payload.statusId === statusId,
    )
  }

  statusStacks(horseId: number, statusId: StatusId): number {
    let n = 0
    for (const e of this.state.effects) {
      if (e.ownerHorseId === horseId && e.payload.statusId === statusId) {
        n += (e.payload.stacks as number) ?? 1
      }
    }
    return n
  }

  emit(ev: RaceEvent): void {
    this.state.events.push(ev)
  }

  equipmentOf(horseId: number): EffectInstance[] {
    return this.state.effects.filter(
      (e) => e.ownerHorseId === horseId && e.primitive === 'Equipment' && !!e.payload.equipId,
    )
  }

  /**
   * 【死亡】：当前速度立即归零，位置不变；恢复期间 vLow 暂时解除；获得 5 秒【重生】。
   * 不清除任何已有的效果实例、装备或状态——死亡只打断速度，不打断构筑。
   */
  settleDeath(horseId: number): void {
    const h = this.horseById(horseId)
    if (h.finished) return
    // 【重生】期间免疫再次【死亡】
    if (this.hasStatus(horseId, 'respawning')) return
    h.v = 0
    h.deathRecover = true
    this.state.effects.push({
      instanceId: this.state.nextInstanceId++,
      sourceCardId: 'system.death',
      primitive: 'Status',
      moduleId: 'mod.death',
      ownerHorseId: horseId,
      appliedAtTick: this.state.tick,
      durationTicks: 5 * 50,
      tags: ['system'],
      payload: { statusId: 'respawning' },
    })
    this.emit({ type: 'death', horseId, tick: this.state.tick })
    this.emit({ type: 'statusAdd', horseId, statusId: 'respawning', tick: this.state.tick })
  }

  private ctxFor(moduleId: string): ModuleCtx {
    return {
      state: this.state,
      mut: this.mut,
      moduleId,
      horseById: (id) => this.horseById(id),
      player: () => this.player(),
      effectsOf: (id) => this.effectsOf(id),
      hasStatus: (id, s) => this.hasStatus(id, s),
      statusStacks: (id, s) => this.statusStacks(id, s),
      emit: (ev) => this.emit(ev),
      requestDeath: (id) => this.settleDeath(id),
      isBlinded: (id) => this.hasStatus(id, 'blindedPro'),
      equipmentOf: (id) => this.equipmentOf(id),
    }
  }

  // -------------------------------------------------------------------------
  // MutationAPI：模块只能通过它写，writes 声明之外的写入直接抛错
  // -------------------------------------------------------------------------

  private assertWrite(moduleId: string, scope: WriteScope): void {
    const allowed = WRITE_MATRIX[scope]
    if (!allowed.includes(moduleId)) {
      throw new Error(`模块 ${moduleId} 未被授权写 ${scope}`)
    }
    const mod = this.moduleById.get(moduleId)
    if (mod && !mod.writes.includes(scope)) {
      throw new Error(`模块 ${moduleId} 的 writes 声明不含 ${scope}`)
    }
  }

  private makeMutationAPI(): MutationAPI {
    const self = this
    return {
      setVelocity(moduleId, horseId, v) {
        self.assertWrite(moduleId, 'speed')
        self.horseById(horseId).v = clamp(v, 0, V_HARD_MAX)
      },
      addStamina(moduleId, horseId, delta) {
        self.assertWrite(moduleId, 'stamina')
        const h = self.horseById(horseId)
        if (!h.isPlayer) return
        h.stamina = Math.max(0, h.stamina + delta)
      },
      jumpPos(moduleId, horseId, pos) {
        self.assertWrite(moduleId, 'pos')
        const h = self.horseById(horseId)
        const from = h.pos
        h.pos = Math.max(0, pos)
        self.fireHook('onPositionJump', (hook, ctx) => hook(ctx, h, from, h.pos))
      },
      setLane(moduleId, horseId, lane) {
        self.assertWrite(moduleId, 'lane')
        self.horseById(horseId).laneIndex = lane
      },
      addFieldMul(moduleId, horseId, delta) {
        self.assertWrite(moduleId, 'field')
        self.horseById(horseId).fieldMul += delta
      },
      mount(_moduleId, inst) {
        const full: EffectInstance = {
          ...inst,
          instanceId: self.state.nextInstanceId++,
          appliedAtTick: self.state.tick,
        }
        self.state.effects.push(full)
        self.fireHook('onEffectApply', (hook, ctx) => hook(ctx, full))
        return full
      },
      remove(_moduleId, instanceId) {
        self.removeInstance(instanceId, 'removed')
      },
      removeByTag(moduleId, horseId, tag, sourceCardId) {
        self.assertWrite(moduleId, 'removeByTag')
        const victims = self.state.effects.filter(
          (e) =>
            (horseId < 0 || e.ownerHorseId === horseId) &&
            e.tags.includes(tag) &&
            (sourceCardId === undefined || e.sourceCardId === sourceCardId),
        )
        for (const v of victims) self.removeInstance(v.instanceId, 'removed')
        return victims.length
      },
      setEnv(moduleId, inst) {
        self.assertWrite(moduleId, 'env')
        self.state.env = inst
      },
      setForcedRank(moduleId, horseId, rank) {
        self.assertWrite(moduleId, 'forcedRank')
        self.state.forcedRank = { horseId, rank }
      },
      setDeckCursor(moduleId, cursor) {
        self.assertWrite(moduleId, 'deckCursor')
        self.state.cursor = clamp(cursor, 0, DECK_SIZE)
      },
      setDrawMode(moduleId, mode) {
        self.assertWrite(moduleId, 'deckCursor')
        self.state.drawMode = mode
      },
      addRefreshCredits(moduleId, n) {
        self.assertWrite(moduleId, 'deckCursor')
        self.state.refreshCredits += n
      },
      addDrawBonus(moduleId, pct) {
        self.assertWrite(moduleId, 'deckCursor')
        self.state.drawBonusPct += pct
      },
      spawnHazard(moduleId, h) {
        self.assertWrite(moduleId, 'hazard')
        self.state.hazards.push({ ...h, hazardId: self.state.nextHazardId++ })
      },
      clearHazard(moduleId, hazardId) {
        self.assertWrite(moduleId, 'hazard')
        self.state.hazards = self.state.hazards.filter((x) => x.hazardId !== hazardId)
      },
      bindAbility(moduleId, binding) {
        self.assertWrite(moduleId, 'abilityBind')
        self.state.abilityBinding = binding
        if (!binding) self.state.abilityHeld = false
      },
      setDeathRecover(moduleId, horseId, on) {
        self.assertWrite(moduleId, 'speed')
        self.horseById(horseId).deathRecover = on
      },
      setEquipSlot(moduleId, horseId, slot, instanceId) {
        self.assertWrite(moduleId, 'equipment')
        const slots = self.equipSlots.get(horseId)!
        if (instanceId === null) slots.delete(slot)
        else slots.set(slot, instanceId)
      },
    }
  }

  private removeInstance(instanceId: number, kind: 'removed' | 'expired'): void {
    const idx = this.state.effects.findIndex((e) => e.instanceId === instanceId)
    if (idx < 0) return
    const inst = this.state.effects[idx]!
    this.state.effects.splice(idx, 1)
    if (this.state.env?.instanceId === instanceId) this.state.env = null
    if (this.state.abilityBinding?.instanceId === instanceId) {
      this.state.abilityBinding = null
      this.state.abilityHeld = false
    }
    const slots = this.equipSlots.get(inst.ownerHorseId)
    if (slots) {
      for (const [slot, id] of [...slots]) if (id === instanceId) slots.delete(slot)
    }
    if (inst.payload.statusId) {
      this.emit({
        type: 'statusEnd',
        horseId: inst.ownerHorseId,
        statusId: inst.payload.statusId,
        tick: this.state.tick,
      })
    }
    this.fireHook(kind === 'expired' ? 'onEffectExpire' : 'onEffectRemove', (hook, ctx) =>
      hook(ctx, inst),
    )
  }

  /** 按 id 字典序调用全部模块的某个钩子 */
  private fireHook<K extends keyof import('./module.ts').ModuleHooks>(
    name: K,
    call: (
      hook: NonNullable<import('./module.ts').ModuleHooks[K]>,
      ctx: ModuleCtx,
    ) => unknown,
  ): void {
    for (const m of this.modules) {
      const hook = m.hooks[name]
      if (hook) call(hook as never, this.ctxFor(m.id))
    }
  }

  // -------------------------------------------------------------------------
  // 卡牌生效
  // -------------------------------------------------------------------------

  /** 把一张卡展开为效果实例并挂载到某匹马上 */
  applyCard(horseId: number, cardId: string): void {
    const def = CARD_BY_ID[cardId]
    if (!def) throw new Error('unknown cardId ' + cardId)
    const bonus = horseId === this.state.playerHorseId ? this.state.drawBonusPct : 0
    for (const decl of def.effects) {
      const payload = { ...decl.payload }
      // 选择困难综合症：后续获得的每张卡额外 +20% 加速（B1），跟随该卡主效果时长
      if (bonus > 0 && decl.primitive !== 'DrawRule') {
        const mods = [...((payload.modifiers as never[]) ?? [])] as {
          target: string
          op: string
          pool?: string
          value: number
        }[]
        mods.push({ target: 'speed', op: 'padd', pool: 'b1', value: bonus })
        payload.modifiers = mods as never
      }
      const inst: EffectInstance = {
        instanceId: this.state.nextInstanceId++,
        sourceCardId: cardId,
        primitive: decl.primitive,
        moduleId: decl.moduleId,
        ownerHorseId: decl.primitive === 'Environment' ? -1 : horseId,
        appliedAtTick: this.state.tick,
        durationTicks: decl.durationTicks,
        tags: decl.tags,
        payload,
      }
      // 瞬时卡的附加加速按 20 秒计
      if (bonus > 0 && decl.durationTicks !== null && decl.durationTicks <= 0) {
        inst.durationTicks = 20 * 50
      }
      this.state.effects.push(inst)
      this.fireHook('onEffectApply', (hook, ctx) => hook(ctx, inst))
    }
    this.emit({ type: 'cardPicked', horseId, cardId, tick: this.state.tick })
  }

  // -------------------------------------------------------------------------
  // 单步推进
  // -------------------------------------------------------------------------

  step(inputs: RaceInput[] = []): void {
    if (this.state.raceOver) return
    this.state.events = []
    const st = this.state

    // ---- 1. 超时 → 输入 ----
    for (const input of inputs) this.handleInput(input)

    // 选牌面板开启期间不推进比赛物理（由外层以 0.1 倍速驱动），但仍然推进 tick
    // 这里不做特殊处理：外层降低调用频率即可，规则内核只认 tick。

    // ---- 2. 效果更新：到期 ----
    const expired = st.effects.filter(
      (e) => e.durationTicks !== null && st.tick - e.appliedAtTick >= e.durationTicks,
    )
    for (const e of expired) this.removeInstance(e.instanceId, 'expired')

    // ---- 3. 触发器与模块自有推进 ----
    this.fireHook('checkTriggers', (hook, ctx) => hook(ctx))
    if (st.forcedRank && !st.playerFinished) this.applyForcedRank()
    this.fireHook('onTick', (hook, ctx) => hook(ctx))

    // ---- 4. 模块速度/体力贡献 ----
    this.contribCache = []
    for (const m of this.modules) {
      const ctx = this.ctxFor(m.id)
      for (const h of st.horses) {
        if (h.finished) continue
        const cs = m.hooks.contributeSpeed?.(ctx, h)
        if (cs) for (const c of cs) this.contribCache.push({ ...c, horseId: h.horseId } as never)
        const cst = m.hooks.contributeStamina?.(ctx, h)
        if (cst) for (const c of cst) this.contribCache.push({ ...c, horseId: h.horseId } as never)
      }
    }
    const byHorse = new Map<number, ModifierContribution[]>()
    for (const c of this.contribCache) {
      const hid = (c as never as { horseId: number }).horseId
      const list = byHorse.get(hid) ?? []
      list.push(c)
      byHorse.set(hid, list)
    }

    // ---- 5. 速度带结算 ----
    for (const h of st.horses) {
      if (h.finished) continue
      const contribs = sortContribs(byHorse.get(h.horseId) ?? [])
      this.resolveBand(h, contribs)
    }

    // ---- 6. 电脑马目标速度（一阶阻尼） ----
    for (const h of st.horses) {
      if (h.finished || h.isPlayer) continue
      this.resolveCpuTarget(h)
    }

    // ---- 7. 外部场与环境乘子（绕过阻尼与 min/max，最外层补全局 clamp） ----
    for (const h of st.horses) h.fieldMul = 0
    this.fireHook('settleField', (hook, ctx) => hook(ctx))

    // ---- 8. 体力与速度 ----
    this.resolveStamina(byHorse)
    for (const h of st.horses) {
      if (h.finished) continue
      if (h.isPlayer) this.integratePlayer(h, byHorse.get(h.horseId) ?? [])
      else this.integrateCpu(h)
    }

    // ---- 9. 位移 ----
    const moved: Array<{ h: HorseState; from: Fixed; to: Fixed }> = []
    for (const h of st.horses) {
      if (h.finished) continue
      const from = h.pos
      h.pos += h.v
      h.dist += h.v
      moved.push({ h, from, to: h.pos })
    }

    // ---- 10. 场与实体结算（排在位移之后：按走过的区间判定，不按坐标相等） ----
    for (const { h, from, to } of moved) {
      this.fireHook('settleEntities', (hook, ctx) => hook(ctx, h, from, to))
    }

    // ---- 11. 里程与终点 ----
    for (const { h } of moved) this.settleMileage(h)
    this.settleFinish()

    // ---- 12. 发牌 ----
    this.settleDraw()

    st.tick++
    if (st.horses.every((h) => h.finished)) {
      st.raceOver = true
      if (!st.endReason) st.endReason = 'finished'
    }
  }

  // -------------------------------------------------------------------------

  private resolveBand(h: HorseState, contribs: ModifierContribution[]): void {
    if (h.isPlayer) {
      const aggSpeed = aggregate(contribs, 'speed')
      const aggMax = aggregate(contribs, 'speedMax')
      const aggMin = aggregate(contribs, 'speedMin')
      let low = applyPipeline(PLAYER_V_LOW, aggSpeed, 0, V_HARD_MAX)
      let high = applyPipeline(PLAYER_V_HIGH, aggSpeed, 0, V_HARD_MAX)
      low = applyPipeline(low, aggMin, 0, V_HARD_MAX)
      high = applyPipeline(high, aggMax, 0, V_HARD_MAX)
      // 【力竭】：速度带压到 vLow
      if (this.hasStatus(h.horseId, 'exhausted')) high = low
      h.bandLow = Math.min(low, high)
      h.bandHigh = high
    } else {
      // 电脑马走同一条流水线，输入换成 base_i，输出即有效基础速度
      const aggSpeed = aggregate(contribs, 'speed')
      const baseEff = applyPipeline(h.cpu!.base, aggSpeed, 0, V_HARD_MAX)
      h.bandLow = h.cpu!.min
      h.bandHigh = baseEff
    }
  }

  private resolveCpuTarget(h: HorseState): void {
    const st = this.state
    const p = this.player()
    const cpu = h.cpu!
    const baseEff = h.bandHigh // resolveBand 把 pipeline 后的有效基础速度放在这里

    let pull = 0
    let slow = 0
    if (!st.playerFinished) {
      // 玩家冲线后关闭追赶项，按各自基础速度自由跑完剩余距离
      const gap = p.pos - h.pos
      pull = mulFx(cpu.gain, Math.max(gap - cpu.slack, 0))
      slow = mulFx(cpu.ease, Math.min(gap + cpu.slack, 0))
    }
    // 抖动必须是 seed 与 tick 的确定性函数
    const noiseUnit = ((H(st.seed, 'noise', h.horseId, st.tick) & 0xffff) * (2 * FP)) / 0xffff - FP
    const noise = mulFx(cpu.amp, Math.trunc(noiseUnit))

    const raw = clamp(baseEff + pull + slow + noise, cpu.min, cpu.max)
    // 一阶阻尼：raw 先钳后阻尼，顺序不能反
    h.cpuTarget += Math.trunc((raw - h.cpuTarget) / cpu.tau)
  }

  private resolveStamina(byHorse: Map<number, ModifierContribution[]>): void {
    const h = this.player()
    if (h.finished) return
    const contribs = sortContribs(byHorse.get(h.horseId) ?? [])
    const wired = this.hasStatus(h.horseId, 'wired')

    if (this.state.fHat > 0) {
      const raw = STAMINA_COST_FACTOR * this.state.fHat
      const cost = applyPipeline(raw, aggregate(contribs, 'staminaCost'), 0, Number.MAX_SAFE_INTEGER)
      h.stamina = Math.max(0, h.stamina - cost)
    } else {
      const regen = applyPipeline(
        STAMINA_REGEN,
        aggregate(contribs, 'staminaRegen'),
        0,
        Number.MAX_SAFE_INTEGER,
      )
      // overcap：恢复不会把体力推回上限之上
      h.stamina = h.stamina >= STAMINA_MAX ? h.stamina : Math.min(h.stamina + regen, STAMINA_MAX)
    }

    const exhausted = this.hasStatus(h.horseId, 'exhausted')
    if (!exhausted && h.stamina <= 0 && !wired) {
      this.state.effects.push({
        instanceId: this.state.nextInstanceId++,
        sourceCardId: 'system.exhaust',
        primitive: 'Status',
        moduleId: 'mod.stamina',
        ownerHorseId: h.horseId,
        appliedAtTick: this.state.tick,
        durationTicks: null,
        tags: ['system', 'debuff'],
        payload: { statusId: 'exhausted' },
      })
      this.emit({ type: 'exhaustEnter', horseId: h.horseId, tick: this.state.tick })
    } else if (exhausted && h.stamina >= EXHAUST_RELEASE) {
      const inst = this.state.effects.find(
        (e) => e.ownerHorseId === h.horseId && e.payload.statusId === 'exhausted',
      )
      if (inst) this.removeInstance(inst.instanceId, 'expired')
      this.emit({ type: 'exhaustExit', horseId: h.horseId, tick: this.state.tick })
    }
  }

  /** 玩家的加速度由点击频率直接得到，速度朝速度带的上界爬升 */
  private integratePlayer(h: HorseState, contribs: ModifierContribution[]): void {
    const st = this.state
    // 等效频率：被 Ability 占用期间固定 0.5，不做实时判定
    if (st.abilityBinding && st.abilityBinding.ownerHorseId === h.horseId) {
      const held = st.abilityBinding.abilityId === 'wheelHold' ? st.abilityHeld : true
      st.fHat = held ? ABILITY_FHAT : 0
    } else if (this.hasStatus(h.horseId, 'exhausted')) {
      st.fHat = 0
    } else {
      st.fHat = this.computeFHat()
    }

    const aggAccel = aggregate(sortContribs(contribs), 'accel')
    const aMax = applyPipeline(A_MAX, aggAccel, 0, fx(10))
    const aIdle = applyPipeline(A_IDLE, aggAccel, fx(-10), 0)
    let a = aIdle + mulFx(st.fHat, aMax - aIdle)
    if (h.deathRecover) a = Math.max(a, DEATH_RECOVER_ACCEL)

    const lo = h.deathRecover ? 0 : h.bandLow
    h.v = clamp(h.v + a, lo, Math.max(h.bandHigh, lo))
    if (h.deathRecover && h.v >= h.bandLow) h.deathRecover = false
    h.v = clamp(h.v, 0, V_HARD_MAX)
  }

  /** 电脑马的加速度由「目标速度 − 当前速度」经有限加减速得到 */
  private integrateCpu(h: HorseState): void {
    const final = clamp(mulFx(h.cpuTarget, FP + h.fieldMul), 0, V_HARD_MAX)
    let a = clamp(final - h.v, -A_MAX, A_MAX)
    if (h.deathRecover) a = Math.max(a, DEATH_RECOVER_ACCEL)
    h.v = clamp(h.v + a, 0, V_HARD_MAX)
    if (h.deathRecover && h.v >= h.cpu!.min) h.deathRecover = false
  }

  private computeFHat(): Fixed {
    const st = this.state
    if (st.lastClickTick < 0 || st.lastIntervalMs < 0) return 0
    const sinceMs = (st.tick - st.lastClickTick) * TICK_MS
    const eff = Math.max(st.lastIntervalMs, sinceMs)
    const dev = Math.abs(eff - RHYTHM_TARGET_MS)
    return clamp(FP - Math.trunc((dev * FP) / RHYTHM_WINDOW_MS), 0, FP)
  }

  // -------------------------------------------------------------------------

  private settleMileage(h: HorseState): void {
    while (h.marksConsumed < CHECKPOINT_MARKS.length && h.dist >= CHECKPOINT_MARKS[h.marksConsumed]!) {
      const mark = h.marksConsumed
      h.marksConsumed++
      this.emit({ type: 'checkpoint', horseId: h.horseId, mark, tick: this.state.tick })
      this.fireHook('onMileageMark', (hook, ctx) => hook(ctx, h, mark))
      if (h.isPlayer) {
        this.openPlayerChoice(mark as 0 | 1 | 2)
      } else {
        this.cpuDraw(h, mark)
      }
    }
  }

  private cpuDraw(h: HorseState, mark: number): void {
    const deck = this.state.cpuDecks[h.horseId]
    if (!deck) return
    const k = this.state.cpuDeckCursor[h.horseId] ?? 0
    if (k >= deck.length || k !== mark) {
      if (k >= deck.length) return
    }
    const cardId = deck[k]!
    this.state.cpuDeckCursor[h.horseId] = k + 1
    this.applyCard(h.horseId, cardId)
  }

  private openPlayerChoice(checkpoint: 0 | 1 | 2): void {
    const st = this.state
    let req: DrawRequest = { checkpoint, mode: st.drawMode, count: CARDS_PER_CHECKPOINT }
    this.fireHook('onDrawRequest', (hook, ctx) => {
      req = hook(ctx, req) ?? req
    })

    if (req.mode === 'cut') {
      st.choices.push({ checkpoint, cardId: null, reason: 'forfeited', refreshes: [] })
      return
    }
    const slotSources: number[] = []
    for (let i = 0; i < req.count; i++) {
      const idx = st.cursor + i
      if (idx < st.deck.length) slotSources.push(idx)
    }
    if (slotSources.length === 0) {
      st.choices.push({ checkpoint, cardId: null, reason: 'forfeited', refreshes: [] })
      return
    }
    const pending = {
      checkpoint,
      candidates: slotSources.map((i) => st.deck[i]!),
      slotSources,
      openedAtTick: st.tick,
      refreshesUsed: [] as number[],
    }
    if (req.mode === 'auto') {
      const pick = hRange(st.seed, 'autopick', [st.autopickIndex++], pending.candidates.length)
      st.pending = pending
      this.resolveChoice(pending.candidates[pick]!, 'picked')
      return
    }
    st.pending = pending
  }

  private settleDraw(): void {
    // 玩家已冲线：未触发的里程档记为 not-reached
    if (!this.state.playerFinished) return
    while (this.state.choices.length < CHECKPOINT_MARKS.length) {
      const cp = this.state.choices.length as 0 | 1 | 2
      this.state.choices.push({ checkpoint: cp, cardId: null, reason: 'not-reached', refreshes: [] })
    }
  }

  // -------------------------------------------------------------------------

  private settleFinish(): void {
    const st = this.state
    const crossing = st.horses.filter((h) => !h.finished && h.pos >= TRACK_LEN)
    if (crossing.length === 0) return
    // 同一 tick 冲线：比较越过 L 的量，大者在前；仍相同按 horseId 升序
    crossing.sort((a, b) => {
      const oa = a.pos - TRACK_LEN
      const ob = b.pos - TRACK_LEN
      if (oa !== ob) return ob - oa
      return a.horseId - b.horseId
    })
    for (const h of crossing) {
      h.finished = true
      h.finishTick = st.tick
      h.finishOvershoot = h.pos - TRACK_LEN
      h.v = 0
      st.finishedOrder.push(h.horseId)
      h.rank = st.finishedOrder.length
      this.emit({ type: 'finish', horseId: h.horseId, rank: h.rank, tick: st.tick })
      this.fireHook('onHorseFinish', (hook, ctx) => hook(ctx, h))
      if (h.isPlayer) {
        st.playerFinished = true
        st.pending = null
        if (!st.endReason) st.endReason = 'finished'
      }
    }
  }

  /** 【版本答案】：玩家名次强制为 1，已冲线的马整体下移一位 */
  applyForcedRank(): void {
    const st = this.state
    if (!st.forcedRank) return
    const p = this.horseById(st.forcedRank.horseId)
    if (p.finished) return
    p.finished = true
    p.finishTick = st.tick
    p.finishOvershoot = 0
    p.v = 0
    st.finishedOrder = [p.horseId, ...st.finishedOrder.filter((id) => id !== p.horseId)]
    st.playerFinished = true
    st.pending = null
    st.endReason = 'forced-combo'
    this.emit({ type: 'combo', horseId: p.horseId, tick: st.tick })
    this.emit({ type: 'finish', horseId: p.horseId, rank: 1, tick: st.tick })
    this.reindexRanks()
  }

  private reindexRanks(): void {
    this.state.finishedOrder.forEach((id, i) => {
      this.horseById(id).rank = i + 1
    })
  }

  // -------------------------------------------------------------------------
  // 输入
  // -------------------------------------------------------------------------

  private handleInput(input: RaceInput): void {
    const st = this.state
    switch (input.kind) {
      case 'gogoDown': {
        if (st.playerFinished) return
        if (st.pending) return
        let consumed = false
        this.fireHook('onInputIntent', (hook, ctx) => {
          if (hook(ctx, 'down')) consumed = true
        })
        if (consumed) return
        if (this.hasStatus(st.playerHorseId, 'exhausted')) {
          this.emit({ type: 'gogoRejected', tick: st.tick })
          return
        }
        this.registerClick()
        return
      }
      case 'gogoUp': {
        this.fireHook('onInputIntent', (hook, ctx) => {
          hook(ctx, 'up')
        })
        return
      }
      case 'pick': {
        if (!st.pending) return
        this.resolveChoice(input.cardId, input.cardId === null ? 'forfeited' : 'picked')
        return
      }
      case 'refresh': {
        this.doRefresh(input.slot)
        return
      }
      case 'timeout': {
        if (!st.pending) return
        this.resolveChoice(null, 'timeout')
        return
      }
    }
  }

  private registerClick(): void {
    const st = this.state
    const sinceMs = st.lastClickTick < 0 ? Infinity : (st.tick - st.lastClickTick) * TICK_MS
    if (sinceMs < RHYTHM_MIN_INTERVAL_MS) {
      this.emit({ type: 'gogoRejected', tick: st.tick })
      return
    }
    if (st.lastClickTick >= 0) {
      st.lastIntervalMs = sinceMs
      st.gogoClicks.push(st.tick - st.lastClickTick)
      const dev = Math.abs(sinceMs - RHYTHM_TARGET_MS)
      const quality = dev <= 100 ? 'good' : sinceMs < RHYTHM_TARGET_MS ? 'early' : 'late'
      this.emit({ type: 'gogo', quality, tick: st.tick })
    } else {
      // 首个点击只建立节奏，不产生 f̂
      st.gogoClicks.push(st.tick)
      this.emit({ type: 'gogo', quality: 'good', tick: st.tick })
    }
    st.lastClickTick = st.tick
  }

  private resolveChoice(cardId: string | null, reason: ChoiceRecord['reason']): void {
    const st = this.state
    const pending = st.pending
    if (!pending) return
    st.choices.push({
      checkpoint: pending.checkpoint,
      cardId,
      reason,
      refreshes: [...pending.refreshesUsed],
    })
    // 游标前进：3 张 + 已刷新的张数；放弃选择游标也前进
    st.cursor = Math.min(DECK_SIZE, st.cursor + CARDS_PER_CHECKPOINT + pending.refreshesUsed.length)
    st.pending = null
    // 抽卡开始清空节奏历史
    st.lastClickTick = -1
    st.lastIntervalMs = -1
    st.fHat = 0
    if (cardId) this.applyCard(st.playerHorseId, cardId)
  }

  private doRefresh(slot: number): void {
    const st = this.state
    const pending = st.pending
    if (!pending) return
    if (st.refreshCredits <= 0) return
    if (slot < 0 || slot >= pending.candidates.length) return
    const nextIdx = st.cursor + CARDS_PER_CHECKPOINT + pending.refreshesUsed.length
    if (nextIdx >= st.deck.length) return
    pending.candidates[slot] = st.deck[nextIdx]!
    pending.slotSources[slot] = nextIdx
    pending.refreshesUsed.push(slot)
    st.refreshCredits -= 1
  }

  // -------------------------------------------------------------------------

  /** 结算记录：将来要进 calldata 的那份 */
  buildResult(raceId: string): import('./types.ts').RaceResult {
    const p = this.player()
    const choices = [...this.state.choices]
    while (choices.length < CHECKPOINT_MARKS.length) {
      choices.push({
        checkpoint: choices.length as 0 | 1 | 2,
        cardId: null,
        reason: 'not-reached',
        refreshes: [],
      })
    }
    return {
      raceId,
      seed: this.state.seed,
      horseId: p.horseId,
      rank: clamp(p.rank, 1, 5) as 1 | 2 | 3 | 4 | 5,
      finishTick: p.finishTick,
      choices: choices.slice(0, 3),
      gogoClicks: [...this.state.gogoClicks],
      endReason: this.state.endReason ?? 'finished',
    }
  }
}

export { divFx, fx }
export type { EffectTag, AbilityBinding, Hazard, EquipSlot }
