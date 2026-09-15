import type {
  AbilityBinding,
  EffectInstance,
  EffectTag,
  EquipSlot,
  Hazard,
  HorseState,
  ModifierContribution,
  RaceEvent,
  RaceState,
  StatusId,
} from './types.ts'
import type { Fixed } from './fixed.ts'

/** 写权限域，与 docs/architecture/effect-system.md §4.2 的矩阵一一对应 */
export type WriteScope =
  | 'speed'
  | 'pos'
  | 'lane'
  | 'field'
  | 'equipment'
  | 'env'
  | 'forcedRank'
  | 'removeByTag'
  | 'deckCursor'
  | 'hazard'
  | 'abilityBind'
  | 'stamina'
  | 'status'

export type ReadScope = 'horses' | 'effects' | 'deck' | 'env' | 'hazards' | 'input'

export interface DrawRequest {
  checkpoint: 0 | 1 | 2
  mode: 'manual' | 'auto' | 'cut'
  count: number
}

export interface ModuleCtx {
  state: RaceState
  mut: MutationAPI
  /** 当前模块 id，由调度器注入 */
  moduleId: string
  horseById(id: number): HorseState
  player(): HorseState
  effectsOf(horseId: number): EffectInstance[]
  hasStatus(horseId: number, statusId: StatusId): boolean
  statusStacks(horseId: number, statusId: StatusId): number
  emit(ev: RaceEvent): void
  /** 请求一次【死亡】结算。归零速度属骨架运动学，由骨架执行，mod.death 提供【重生】声明 */
  requestDeath(horseId: number): void
  /** 该马是否处于【目中无人】：其他马不与之交换、炸不到它、天气也不影响它 */
  isBlinded(horseId: number): boolean
  /** 某匹马当前挂载的装备实例 */
  equipmentOf(horseId: number): EffectInstance[]
}

export interface MutationAPI {
  setVelocity(moduleId: string, horseId: number, v: Fixed): void
  addStamina(moduleId: string, horseId: number, delta: Fixed): void
  jumpPos(moduleId: string, horseId: number, pos: Fixed): void
  setLane(moduleId: string, horseId: number, lane: number): void
  addFieldMul(moduleId: string, horseId: number, delta: Fixed): void
  mount(moduleId: string, inst: Omit<EffectInstance, 'instanceId' | 'appliedAtTick'>): EffectInstance
  remove(moduleId: string, instanceId: number): void
  removeByTag(moduleId: string, horseId: number, tag: EffectTag, sourceCardId?: string): number
  setEnv(moduleId: string, inst: EffectInstance | null): void
  setForcedRank(moduleId: string, horseId: number, rank: number): void
  setDeckCursor(moduleId: string, cursor: number): void
  setDrawMode(moduleId: string, mode: 'manual' | 'auto' | 'cut'): void
  addRefreshCredits(moduleId: string, n: number): void
  addDrawBonus(moduleId: string, pct: Fixed): void
  spawnHazard(moduleId: string, h: Omit<Hazard, 'hazardId'>): void
  clearHazard(moduleId: string, hazardId: number): void
  bindAbility(moduleId: string, binding: AbilityBinding | null): void
  setDeathRecover(moduleId: string, horseId: number, on: boolean): void
  setEquipSlot(moduleId: string, horseId: number, slot: EquipSlot, instanceId: number | null): void
}

export interface ModuleHooks {
  /** 效果实例挂载。瞬时动作在这里执行 */
  onEffectApply(ctx: ModuleCtx, inst: EffectInstance): void
  /** 被移除（转移、插槽覆盖、单槽替换、按 tag 抑制），区别于到期 */
  onEffectRemove(ctx: ModuleCtx, inst: EffectInstance): void
  /** 到期 */
  onEffectExpire(ctx: ModuleCtx, inst: EffectInstance): void
  /** 只返回乘区贡献，不直接写速度 */
  contributeSpeed(ctx: ModuleCtx, horse: HorseState): ModifierContribution[]
  contributeStamina(ctx: ModuleCtx, horse: HorseState): ModifierContribution[]
  /** gogo 按钮的语义由当前绑定解释；返回 true 表示已消费该输入 */
  onInputIntent(ctx: ModuleCtx, intent: 'down' | 'up'): boolean | void
  /** 外部场与环境乘子：写 field_i，排在电脑马目标速度之后 */
  settleField(ctx: ModuleCtx): void
  /** 位移之后的场与实体结算 */
  settleEntities(ctx: ModuleCtx, horse: HorseState, from: Fixed, to: Fixed): void
  /** 交换等瞬时置换 */
  onPositionJump(ctx: ModuleCtx, horse: HorseState, from: Fixed, to: Fixed): void
  /** 里程跨过 0.25L / 0.50L / 0.75L */
  onMileageMark(ctx: ModuleCtx, horse: HorseState, markIndex: number): void
  /** 修改牌堆游标行为 */
  onDrawRequest(ctx: ModuleCtx, req: DrawRequest): DrawRequest
  onHorseFinish(ctx: ModuleCtx, horse: HorseState): void
  /** 条件触发器检查，排在效果更新之后 */
  checkTriggers(ctx: ModuleCtx): void
  /** 每 tick 的模块自有推进（层数衰减、冷却等） */
  onTick(ctx: ModuleCtx): void
}

export interface RaceModule {
  /** 稳定字符串，决定同 tick 内的执行顺序（字典序，不是注册顺序） */
  id: string
  version: number
  reads: ReadScope[]
  writes: WriteScope[]
  hooks: Partial<ModuleHooks>
}

/** 模块执行顺序 = id 的字典序 */
export function orderModules(mods: RaceModule[]): RaceModule[] {
  return [...mods].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** rulesVersion 的组成：模块清单 + 各自 version */
export function modulesFingerprint(mods: RaceModule[]): string {
  return orderModules(mods)
    .map((m) => m.id + '@' + m.version)
    .join(';')
}
