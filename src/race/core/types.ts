import type { Fixed } from './fixed.ts'

// ---------------------------------------------------------------------------
// 效果原语
// ---------------------------------------------------------------------------

export type PrimitiveKind =
  | 'Modifier'
  | 'Status'
  | 'Equipment'
  | 'Ability'
  | 'Hazard'
  | 'Field'
  | 'DrawRule'
  | 'Environment'
  | 'Trigger'

export type EffectTag = 'buff' | 'debuff' | 'equipment' | 'env' | 'system'

export type StackPolicy = 'independent' | 'replace' | 'refresh' | 'stackable'

export type ModifierTarget =
  | 'speed'
  | 'speedMax'
  | 'speedMin'
  | 'accel'
  | 'staminaCost'
  | 'staminaRegen'

export type ModifierOp = 'add' | 'padd' | 'mul'
export type PaddPool = 'b1' | 'b2' | 'b3' | 'b4'

export type StatusId =
  | 'airborne'
  | 'death'
  | 'respawning'
  | 'luckE'
  | 'burning'
  | 'wired'
  | 'coat'
  | 'blindedPro'
  | 'swapCooldown'
  | 'exhausted'

export interface ModifierGate {
  status?: StatusId
  resource?: 'stamina'
  below?: Fixed
  above?: Fixed
}

export interface ModifierDecl {
  target: ModifierTarget
  op: ModifierOp
  pool?: PaddPool
  value: Fixed
  gate?: ModifierGate
}

/** 模块向骨架返回的乘区贡献，骨架按固定阶段顺序聚合 */
export interface ModifierContribution extends ModifierDecl {
  moduleId: string
  instanceId: number
}

export interface EffectInstance {
  instanceId: number
  sourceCardId: string
  primitive: PrimitiveKind
  moduleId: string
  /** -1 表示全局（环境槽） */
  ownerHorseId: number
  appliedAtTick: number
  /** null = 持续到比赛结束 */
  durationTicks: number | null
  tags: EffectTag[]
  payload: EffectPayload
}

export interface EffectPayload {
  modifiers?: ModifierDecl[]
  statusId?: StatusId
  stacks?: number
  slot?: EquipSlot
  equipId?: string
  abilityId?: AbilityId
  fieldKind?: 'gravityWell'
  radius?: Fixed
  drawRule?: 'refresh' | 'auto' | 'cut'
  windDir?: 1 | -1
  trigger?: TriggerDecl
  coat?: string
  [k: string]: unknown
}

export type EquipSlot =
  | 'torso'
  | 'head'
  | 'hoof_fl'
  | 'hoof_fr'
  | 'hoof_bl'
  | 'hoof_br'
  | 'tail'

export type AbilityId = 'clapSwap' | 'wheelHold'

export interface TriggerDecl {
  kind: 'onExpire' | 'stackThreshold' | 'setMatch'
  statusId?: StatusId
  threshold?: number
  action: 'death' | 'forcedRank'
  all?: string[]
  anyOf?: string[][]
}

// ---------------------------------------------------------------------------
// 马匹与比赛状态
// ---------------------------------------------------------------------------

export interface CpuParams {
  base: Fixed
  min: Fixed
  max: Fixed
  gain: Fixed
  slack: Fixed
  ease: Fixed
  amp: Fixed
  tau: number
}

export interface HorseState {
  horseId: number
  /** 站位，只由【交换】修改；不参与速度、里程、名次或同 tick 兜底排序 */
  laneIndex: number
  isPlayer: boolean
  pos: Fixed
  dist: Fixed
  v: Fixed
  stamina: Fixed
  /** 已消费的里程档数 0..3 */
  marksConsumed: number
  finished: boolean
  finishTick: number
  finishOvershoot: Fixed
  rank: number
  /** 【死亡】恢复期间暂时解除 vLow 下界 */
  deathRecover: boolean
  /** 本 tick 的外部场乘子累加（B3/B4 之外，作用于电脑马目标速度） */
  fieldMul: Fixed
  /** 电脑马性格参数，玩家马为 null */
  cpu: CpuParams | null
  /** 电脑马的一阶阻尼目标速度 */
  cpuTarget: Fixed
  /** 本 tick 结算出的速度带（表现层只读） */
  bandLow: Fixed
  bandHigh: Fixed
}

export interface Hazard {
  hazardId: number
  laneIndex: number
  pos: Fixed
  sourceCardId: string
}

export interface AbilityBinding {
  abilityId: AbilityId
  instanceId: number
  ownerHorseId: number
}

export type DrawMode = 'manual' | 'auto' | 'cut'

export type ChoiceReason = 'picked' | 'forfeited' | 'timeout' | 'not-reached'

export interface ChoiceRecord {
  checkpoint: 0 | 1 | 2
  cardId: string | null
  reason: ChoiceReason
  refreshes: number[]
}

export interface PendingChoice {
  checkpoint: 0 | 1 | 2
  /** 展示中的三张（cardId） */
  candidates: string[]
  /** 每张牌对应的牌堆下标，用于刷新记账 */
  slotSources: number[]
  openedAtTick: number
  /** 现实时间起点由外层注入，规则内核只记录是否已超时 */
  refreshesUsed: number[]
}

export type RaceEvent =
  | { type: 'cardEffect'; horseId: number; cardId?: string; kind: 'trigger' | 'resource' | 'fixed' | 'target' | 'guard' | 'renew'; value: number; tick: number }
  | { type: 'gogo'; quality: 'good' | 'early' | 'late'; tick: number }
  | { type: 'gogoRejected'; tick: number }
  | { type: 'death'; horseId: number; tick: number }
  | { type: 'respawnEnd'; horseId: number; tick: number }
  | { type: 'explosion'; laneIndex: number; pos: Fixed; horseId: number; tick: number }
  | { type: 'hazardPlaced'; laneIndex: number; pos: Fixed; tick: number }
  | { type: 'swap'; a: number; b: number; tick: number }
  | { type: 'equipOn'; horseId: number; equipId: string; slot: EquipSlot; tick: number }
  | { type: 'equipOff'; horseId: number; equipId: string; slot: EquipSlot; tick: number }
  | { type: 'steal'; from: number; to: number; equipId: string; tick: number }
  | { type: 'statusAdd'; horseId: number; statusId: StatusId; tick: number }
  | { type: 'statusStack'; horseId: number; statusId: StatusId; stacks: number; tick: number }
  | { type: 'statusEnd'; horseId: number; statusId: StatusId; tick: number }
  | { type: 'checkpoint'; horseId: number; mark: number; tick: number }
  | { type: 'cardPicked'; horseId: number; cardId: string; tick: number }
  | { type: 'exhaustEnter'; horseId: number; tick: number }
  | { type: 'exhaustExit'; horseId: number; tick: number }
  | { type: 'wind'; dir: 1 | -1; tick: number }
  | { type: 'finish'; horseId: number; rank: number; tick: number }
  | { type: 'combo'; horseId: number; tick: number }

export interface RaceState {
  seed: string
  rulesVersion: string
  tick: number
  stakeTier: number
  playerHorseId: number
  horses: HorseState[]
  effects: EffectInstance[]
  nextInstanceId: number
  env: EffectInstance | null
  hazards: Hazard[]
  nextHazardId: number

  /** 玩家牌堆与游标 */
  deck: string[]
  cursor: number
  refreshCredits: number
  drawMode: DrawMode
  /** 选择困难综合症：后续每张卡额外 +20% 加速（B1） */
  drawBonusPct: Fixed

  pending: PendingChoice | null
  choices: ChoiceRecord[]
  gogoClicks: number[]

  abilityBinding: AbilityBinding | null
  /** 长按类 Ability 当前是否按住 */
  abilityHeld: boolean

  /** 电脑马私有牌堆 */
  cpuDecks: Record<number, string[]>
  cpuDeckCursor: Record<number, number>

  finishedOrder: number[]
  forcedRank: { horseId: number; rank: number } | null
  endReason: 'finished' | 'forced-combo' | null
  playerFinished: boolean
  raceOver: boolean

  /** 玩家节奏状态 */
  lastClickTick: number
  lastIntervalMs: number
  fHat: Fixed

  swapIndex: number
  windIndex: number
  stealIndex: number
  autopickIndex: number

  /** 本 tick 产生的表现事件，外层每 tick 取走 */
  events: RaceEvent[]
}

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

export type RaceInput =
  | { kind: 'gogoDown' }
  | { kind: 'gogoUp' }
  | { kind: 'pick'; cardId: string | null }
  | { kind: 'refresh'; slot: number }
  | { kind: 'timeout' }

// ---------------------------------------------------------------------------
// 结算记录（将来进 calldata 的那份，字段此刻定死）
// ---------------------------------------------------------------------------

export interface RaceResult {
  raceId: string
  seed: string
  horseId: number
  rank: 1 | 2 | 3 | 4 | 5
  finishTick: number
  choices: Array<{
    checkpoint: 0 | 1 | 2
    cardId: string | null
    reason: ChoiceReason
    refreshes: number[]
  }>
  gogoClicks: number[]
  endReason: 'finished' | 'forced-combo'
}
