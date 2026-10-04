/**
 * 有奖战绩的只读查询：从 Envio 索引器（`VITE_ENVIO_GRAPHQL_URL`）取某个账户最近的会话。
 *
 * 这里的数据是**可回滚的读模型**：链重组、索引滞后、免费托管被回收都会让它与链上不一致。它只用于
 * 展示历史，**绝不**用来决定余额、下注、会话是否未完结或返还多少——那些一律经 RPC 读 PonyGame/PonyVault
 * （`funds.ts`、`paidSession.ts`）。因此本模块不导出任何余额类数据，结果里也标明来源与已索引到的块。
 *
 * **永不抛错**：未配置、网络失败、HTTP/GraphQL 错误与响应形状不对都以带 `status` 的结果返回；
 * 只要有一行不合规就整体判为 `malformed`，不展示半真半假的列表。
 */
import { getAddress, isAddress, type Address, type Hex } from 'viem'
import { CHAIN } from './network.ts'
import { normalizeRoster, type PonyRoster } from '../race/core/roster.ts'

/**
 * 端点只从构建期变量读取，不接受 URL 参数。要求 https；http 只放行本机开发地址。
 * 空值与非法值都视为未配置。
 */
export function parseGraphqlUrl(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  if (url.username || url.password) return null
  return url.toString()
}

export const ENVIO_GRAPHQL_URL = parseGraphqlUrl(import.meta.env?.VITE_ENVIO_GRAPHQL_URL as string | undefined)

export type HistorySessionState = 'open' | 'settled' | 'forfeited'
/** `SessionForfeited.reason`：1 = 所需随机锚过窗丢失，2 = owner 关闭求时器故障会话。 */
export type ForfeitReason = 'anchor-lost' | 'solver-fault' | 'unknown'

export type HistoryChoice = {
  checkpoint: number
  /** 0 = 主动放弃该检查点 */
  cardId: number
  /** 结算后才知道提交是否生效；未结算或判负（从未求时）为 null */
  effective: boolean | null
}

/** 一场有奖比赛的历史记录。仅供展示，不是资金或会话状态的依据。 */
export type HistorySession = {
  roster?: readonly number[]
  sessionId: Hex
  horseId: number
  stake: bigint
  state: HistorySessionState
  /** T0，unix 秒 */
  openedAt: number
  openedBlock: bigint
  openTx: Hex
  choices: HistoryChoice[]
  settlementRank: number | null
  rawRank: number | null
  /** 总返还（含本金），判负为 0，未完结为 null */
  payout: bigint | null
  /** payout − stake；未完结为 null */
  net: bigint | null
  forfeitReason: ForfeitReason | null
  /** 结算或判负所在块的时间，unix 秒 */
  closedAt: number | null
  closeTx: Hex | null
}

export type HistoryErrorCode = 'invalid-player' | 'network' | 'http' | 'graphql' | 'malformed'

export type HistoryResult =
  | { status: 'not-configured' }
  | {
      status: 'ok'
      source: 'envio-read-model'
      sessions: HistorySession[]
      /** 索引器在本链已处理到的块；读不到为 null。晚于该块的交易还不会出现在列表里。 */
      indexedBlock: bigint | null
      /** 索引器是否已追上链头 */
      ready: boolean
    }
  | { status: 'error'; code: HistoryErrorCode; detail: string }

export type HistoryDeps = {
  /** 默认 ENVIO_GRAPHQL_URL；显式传 null 表示未配置 */
  url?: string | null
  fetchImpl?: typeof fetch
  /** 条数，1..50，默认 20 */
  limit?: number
  /** 超时，毫秒，默认 10000 */
  timeoutMs?: number
}

export const HISTORY_QUERY = `query RecentSessions($player: String!, $limit: Int!) {
  Session(where: { player_id: { _eq: $player } }, order_by: { openedBlock: desc }, limit: $limit) {
    id horseId roster stake state openedAt openedBlock openTx
    playerSettlementRank playerRawRank payout net forfeitReason closedAt closeTx
    choices { checkpoint cardId effective }
  }
  _meta { chainId progressBlock isReady }
}`

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/** 取某账户（玩家的 sma-b，即合约里的 player）最近的有奖会话，按开场块倒序。 */
export async function fetchRecentSessions(player: string, deps: HistoryDeps = {}): Promise<HistoryResult> {
  const url = deps.url === undefined ? ENVIO_GRAPHQL_URL : parseGraphqlUrl(deps.url)
  if (!url) return { status: 'not-configured' }
  if (!isAddress(player, { strict: false })) return { status: 'error', code: 'invalid-player', detail: player }
  // 索引器按 EIP-55 校验和形式存地址（Envio 默认 address_format: checksum）。
  const account: Address = getAddress(player)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(deps.limit ?? DEFAULT_LIMIT)))

  const doFetch = deps.fetchImpl ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000)
  let body: unknown
  try {
    let query = HISTORY_QUERY
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await doFetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { player: account, limit } }), signal: controller.signal,
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        return { status: 'error', code: 'http', detail: detail || `HTTP ${res.status}` }
      }
      body = await res.json().catch(() => undefined)
      const oldSchema = isRecord(body) && Array.isArray(body.errors) && body.errors.some(error => isRecord(error)
        && typeof error.message === 'string' && /cannot query field "roster"|field ['"]roster['"] (?:was )?not found/i.test(error.message))
      if (attempt === 0 && oldSchema) { query = HISTORY_QUERY.replace('id horseId roster stake', 'id horseId stake'); continue }
      break
    }
  } catch (err) {
    return { status: 'error', code: 'network', detail: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
  return parseHistoryResponse(body, CHAIN.id)
}

/** 纯函数：把 GraphQL 响应体解析成 HistoryResult。导出以便单测直接喂各种畸形输入。 */
export function parseHistoryResponse(body: unknown, chainId: number): HistoryResult {
  if (!isRecord(body)) return malformed('response is not a JSON object')
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0]
    const message = isRecord(first) && typeof first.message === 'string' ? first.message : 'GraphQL error'
    return { status: 'error', code: 'graphql', detail: message.slice(0, 200) }
  }
  const data = body.data
  if (!isRecord(data) || !Array.isArray(data.Session)) return malformed('data.Session is not a list')

  const sessions: HistorySession[] = []
  for (const [i, row] of data.Session.entries()) {
    const session = parseSession(row)
    if (typeof session === 'string') return malformed(`Session[${i}]: ${session}`)
    sessions.push(session)
  }

  let indexedBlock: bigint | null = null
  let ready = false
  if (Array.isArray(data._meta)) {
    const meta = data._meta.find((m) => isRecord(m) && m.chainId === chainId)
    if (isRecord(meta)) {
      indexedBlock = toBigInt(meta.progressBlock)
      ready = meta.isReady === true
    }
  }
  return { status: 'ok', source: 'envio-read-model', sessions, indexedBlock, ready }
}

const STATES: Record<string, HistorySessionState> = { OPEN: 'open', SETTLED: 'settled', FORFEITED: 'forfeited' }
const REASONS: Record<number, ForfeitReason> = { 1: 'anchor-lost', 2: 'solver-fault' }
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** 返回解析好的会话，或描述第一处不合规的字符串。 */
function parseSession(row: unknown): HistorySession | string {
  if (!isRecord(row)) return 'not an object'
  const sessionId = row.id
  if (typeof sessionId !== 'string' || !HASH_RE.test(sessionId)) return 'id'
  const state = typeof row.state === 'string' ? STATES[row.state] : undefined
  if (!state) return 'state'
  const horseId = toInt(row.horseId)
  if (horseId === null || horseId < 0 || horseId > 4) return 'horseId'
  let roster: PonyRoster | undefined
  if (row.roster !== undefined && row.roster !== null) {
    try { roster = normalizeRoster(row.roster) } catch { return 'roster' }
  }
  const stake = toBigInt(row.stake)
  if (stake === null || stake <= 0n) return 'stake'
  const openedAt = toInt(row.openedAt)
  if (openedAt === null) return 'openedAt'
  const openedBlock = toBigInt(row.openedBlock)
  if (openedBlock === null) return 'openedBlock'
  if (typeof row.openTx !== 'string' || !HASH_RE.test(row.openTx)) return 'openTx'

  const settlementRank = optional(row.playerSettlementRank, toInt)
  if (settlementRank === undefined) return 'playerSettlementRank'
  const rawRank = optional(row.playerRawRank, toInt)
  if (rawRank === undefined) return 'playerRawRank'
  const payout = optional(row.payout, toBigInt)
  if (payout === undefined) return 'payout'
  const net = optional(row.net, toBigInt)
  if (net === undefined) return 'net'
  const reasonCode = optional(row.forfeitReason, toInt)
  if (reasonCode === undefined) return 'forfeitReason'
  const closedAt = optional(row.closedAt, toInt)
  if (closedAt === undefined) return 'closedAt'
  const closeTx = optional(row.closeTx, (v) => (typeof v === 'string' && HASH_RE.test(v) ? (v as Hex) : null))
  if (closeTx === undefined) return 'closeTx'
  if (state === 'settled' && (settlementRank === null || payout === null || net === null || closedAt === null)) {
    return 'settled session without settlement fields'
  }
  if (state === 'forfeited' && (payout !== 0n || closedAt === null)) return 'forfeited session without payout 0'
  if (state === 'open' && (payout !== null || closedAt !== null)) return 'open session with closing fields'

  if (!Array.isArray(row.choices)) return 'choices'
  const choices: HistoryChoice[] = []
  for (const c of row.choices) {
    if (!isRecord(c)) return 'choice'
    const checkpoint = toInt(c.checkpoint)
    const cardId = toInt(c.cardId)
    if (checkpoint === null || checkpoint < 1 || checkpoint > 3) return 'choice.checkpoint'
    if (cardId === null || cardId < 0) return 'choice.cardId'
    if (c.effective !== null && c.effective !== undefined && typeof c.effective !== 'boolean') return 'choice.effective'
    choices.push({ checkpoint, cardId, effective: typeof c.effective === 'boolean' ? c.effective : null })
  }
  choices.sort((a, b) => a.checkpoint - b.checkpoint)

  return {
    sessionId: sessionId as Hex,
    horseId,
    ...(roster ? { roster } : {}),
    stake,
    state,
    openedAt,
    openedBlock,
    openTx: row.openTx as Hex,
    choices,
    settlementRank,
    rawRank,
    payout,
    net,
    forfeitReason: reasonCode === null ? null : (REASONS[reasonCode] ?? 'unknown'),
    closedAt,
    closeTx,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Envio 的 GraphQL 把 BigInt 列序列化成十进制字符串；也接受安全范围内的 JSON 整数。 */
function toBigInt(v: unknown): bigint | null {
  if (typeof v === 'string' && /^-?\d{1,78}$/.test(v)) return BigInt(v)
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v)
  return null
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^-?\d{1,15}$/.test(v)) return Number(v)
  return null
}

/** null/缺省 → null；有值但解析失败 → undefined（调用方据此报 malformed）。 */
function optional<T>(v: unknown, parse: (v: unknown) => T | null): T | null | undefined {
  if (v === null || v === undefined) return null
  const parsed = parse(v)
  return parsed === null ? undefined : parsed
}

function malformed(detail: string): HistoryResult {
  return { status: 'error', code: 'malformed', detail }
}
