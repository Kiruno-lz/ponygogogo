/**
 * P5 测试网真实有奖会话（会话协议 v2）：走产品路径——src/chain/alchemy.ts 的 AlchemyAccount（sma-b，Alchemy 赞助）
 * + src/chain/paidSession.ts 的开场/选牌/结算 + src/chain/funds.ts 的提款——在 Monad 测试网跑一场
 * 充值+开场 → 选牌 → 等规范冲线 → 结算 → 提款，逐笔记录 call id、交易哈希、块、时间戳、gasUsed 与时延，
 * 并把 previewSettlement / SessionSettled 与 TS `solvePaidRace`（同一链上输入）逐字段比对。
 *
 * 默认只模拟（读链、eth_call、Alchemy prepareCalls 估算），不发任何交易；`--send` 才发送。开新场还要 `--open`，
 * 避免重跑时误开第二场；不带 `--open` 时只恢复并走完未完结会话，没有会话就只提款。
 *
 * 私钥只从文件读，从不输出：玩家 PLAYER_KEY_PATH（缺省 keys/ponygogogo-testnet-player.private，`--create-player`
 * 在缺失时随机生成并以 0600 写入）；部署者 DEPLOYER_PRIVATE_KEY_PATH（只在 sma-b 需要充值时读，充值额受 --max-topup
 * 限制）。Alchemy API key / Policy ID 与合约地址取 .env 的 VITE_*（Bun 自动加载），打印前一律打码。
 * 本脚本只在命令行手动运行，不属于任何测试集。
 *
 * 用法：
 *   bun scripts/testnet-session.ts [--create-player]         # 模拟：解析 sma-b、读余额/会话、prepareCalls 估算
 *   bun scripts/testnet-session.ts --send --open             # 充值差额 → 开场 → 选牌 → 等冲线 → 时延采样 → 结算 → 提款
 *   bun scripts/testnet-session.ts --send                    # 恢复未完结会话并走完；无会话则只提款
 *   PLAYER_KEY_PATH=keys/<probe>.private bun scripts/testnet-session.ts --create-player --send --session 0x… --no-settle
 *                                                            # 另一个 sma-b 对任意开放会话发 sealAnchors 时延样本（任何人可调）
 *   bun scripts/testnet-session.ts --heavy [--send]          # 重结算可行性：prepareCalls 估算约 11M/23M/29M 调用 gas，
 *                                                            # --send 时把最接近 23M 的那一批（只读 solve）发一次
 * 选项：--game/--vault 地址（缺省 .env 的 VITE_PONY_GAME_ADDRESS / VITE_PONY_VAULT_ADDRESS）--session ID（缺省本账户的
 *       sessionOf；非玩家账户只采样/结算，不选牌）--no-settle（采样后留着会话）--horse N（0..4，缺省 2）--tier N（1..4，
 *       缺省 1）--samples N（sealAnchors 时延样本，缺省 16）--choose-delay-ms N（确认过 openSec 后再等多久点击，缺省 1500）
 *       --max-topup MON（缺省 0.35，够第 1 档 0.3 MON 下注加 gas）--out 目录（缺省 runs/）
 * Alchemy 赞助策略按 spender 限次（实测约 75 s 内第 11 次被拒「max count per spender exceeded」，稍后恢复）：
 * 采样遇拒即停，结算/提款遇拒不重试，报告里记录原因。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { alchemyWalletTransport, createSmartWalletClient, type SmartWalletClient } from '@alchemy/wallet-apis'
import {
  createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, isAddressEqual, parseAbi, parseEther,
  type Address, type Hex, type PublicClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { AlchemyAccount, type CallAccount, type CallProgress, type ContractCall } from '../src/chain/alchemy.ts'
import { ChainClock, startClockSync } from '../src/chain/chainClock.ts'
import { readFunds, trackCall, withdrawCall, withdrawFromVault } from '../src/chain/funds.ts'
import { CHAIN } from '../src/chain/network.ts'
import {
  chooseCardCall, openSessionCalls, ponyGameAbi, sealAnchorsCall, SESSION_STATE, settleSessionCall,
} from '../src/chain/paidCalls.ts'
import {
  choosePaidCard, errorReason, openPaidSession, readSessionFacts, readVaultAvailable, recoverPaidSession,
  settlePaidSession, type PaidChainDeps, type PaidChoiceFacts, type PaidSessionFacts,
} from '../src/chain/paidSession.ts'
import { PAID_STAKE_WEI } from '../src/chain/paidStakes.ts'
import { PAID_RULESET_HASH } from '../src/race/paid/cardRules.ts'
import { derivePaidCoreInput, solvePaidRace, type PaidRaceInput } from '../src/race/paid/race.ts'
import { checkPaidChoice, type PaidChoiceSlot, type PaidChoiceSlots, type PaidSolveResult } from '../src/race/paid/solver.ts'
import { solveFromFacts } from '../src/race/paidResult.ts'
import { acceptsClick, ALCHEMY_TIMING, maySend, settleReadyWall, type WallRange } from '../src/race/paidWindow.ts'
import { readDeployerKey } from './keeper.ts'

const ROOT = resolve(import.meta.dir, '..')
const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex
const MULTIPLIER_BPS = [30_000n, 15_000n, 10_000n, 0n, 0n]
const POLL = { pollMs: 100, timeoutMs: 90_000 }

const extraGameAbi = parseAbi([
  'struct ChoiceInput { bool present; uint32 txSec; uint8 cardId; uint8[] refreshSlots; bytes32 anchor; }',
  'struct RaceInput { bytes32 seed; bytes32 openAnchor; uint8 stakeTier; uint8 playerHorseId; ChoiceInput[3] choices; }',
  'function raceInput(bytes32 sessionId) view returns (RaceInput)',
  'function solver() view returns (address)',
  'function owner() view returns (address)',
])
const vaultStateAbi = parseAbi([
  'function game() view returns (address)',
  'function entryPaused() view returns (bool)',
  'function houseLiquidity() view returns (uint256)',
  'function reservedLiquidity() view returns (uint256)',
  'function totalAvailable() view returns (uint256)',
  'function totalLocked() view returns (uint256)',
  'function available(address) view returns (uint256)',
])
const solverAbi = parseAbi([
  'struct ChoiceInput { bool present; uint32 txSec; uint8 cardId; uint8[] refreshSlots; bytes32 anchor; }',
  'struct RaceInput { bytes32 seed; bytes32 openAnchor; uint8 stakeTier; uint8 playerHorseId; ChoiceInput[3] choices; }',
  'struct RaceResult { uint32[5] finishTime; uint32[5] finishWall; uint8[5] rawOrder; uint8[5] settlementOrder; uint8 playerRawRank; uint8 playerSettlementRank; uint8[3] acquired; uint32 eventCount; bytes32 digest; }',
  'function solve(RaceInput input) view returns (RaceResult)',
  'function rulesetHash() view returns (bytes32)',
])

// ------------------------------------------------------------------------------------------------ config

export type SessionScriptConfig = {
  send: boolean
  open: boolean
  heavy: boolean
  settle: boolean
  sessionId: Hex | null
  createPlayer: boolean
  horse: number
  tier: 1 | 2 | 3 | 4
  samples: number
  chooseDelayMs: number
  maxTopup: bigint
  outDir: string
  rpcUrl: string
  apiKey: string
  policyId: string
  game: Address
  vault: Address
  playerKeyPath: string
  deployerKeyPath: string | null
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function intFlag(argv: readonly string[], name: string, fallback: number, min: number, max: number): number {
  const raw = flag(argv, name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`INVALID_${name.slice(2).toUpperCase()}`)
  return n
}

export function parseSessionConfig(env: Record<string, string | undefined>, argv: readonly string[]): SessionScriptConfig {
  const game = flag(argv, '--game') ?? env.VITE_PONY_GAME_ADDRESS ?? ''
  const vault = flag(argv, '--vault') ?? env.VITE_PONY_VAULT_ADDRESS ?? ''
  const sessionId = flag(argv, '--session') ?? null
  if (sessionId !== null && !/^0x[0-9a-fA-F]{64}$/.test(sessionId)) throw new Error('INVALID_SESSION')
  if (!/^0x[0-9a-fA-F]{40}$/.test(game) || !/^0x[0-9a-fA-F]{40}$/.test(vault)) throw new Error('MISSING_CONTRACT_ADDRESSES')
  const apiKey = env.VITE_ALCHEMY_API_KEY ?? ''
  const policyId = env.VITE_ALCHEMY_POLICY_ID ?? ''
  if (!apiKey || !policyId) throw new Error('MISSING_ALCHEMY_CONFIG')
  const rpcUrl = env.VITE_MONAD_RPC_URL || CHAIN.rpcUrls.default.http[0]!
  const maxTopupRaw = flag(argv, '--max-topup') ?? '0.35'
  if (!/^\d+(\.\d+)?$/.test(maxTopupRaw)) throw new Error('INVALID_MAX_TOPUP')
  return {
    send: argv.includes('--send'),
    open: argv.includes('--open'),
    heavy: argv.includes('--heavy'),
    settle: !argv.includes('--no-settle'),
    sessionId: sessionId as Hex | null,
    createPlayer: argv.includes('--create-player'),
    horse: intFlag(argv, '--horse', 2, 0, 4),
    tier: intFlag(argv, '--tier', 1, 1, 4) as 1 | 2 | 3 | 4,
    samples: intFlag(argv, '--samples', 16, 0, 40),
    chooseDelayMs: intFlag(argv, '--choose-delay-ms', 1500, 0, 15_000),
    maxTopup: parseEther(maxTopupRaw),
    outDir: resolve(ROOT, flag(argv, '--out') ?? 'runs'),
    rpcUrl,
    apiKey,
    policyId,
    game: game as Address,
    vault: vault as Address,
    playerKeyPath: resolve(ROOT, env.PLAYER_KEY_PATH || 'keys/ponygogogo-testnet-player.private'),
    deployerKeyPath: env.DEPLOYER_PRIVATE_KEY_PATH ? resolve(ROOT, env.DEPLOYER_PRIVATE_KEY_PATH) : null,
  }
}

// ------------------------------------------------------------------------------------------------ pure helpers

/** Nearest-rank percentile of a non-empty sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)))
  return sorted[rank - 1]!
}

export function stats(values: readonly number[]): { n: number; min: number; p50: number; p95: number; max: number; mean: number } {
  const n = values.length
  const mean = n === 0 ? Number.NaN : Math.round(values.reduce((a, b) => a + b, 0) / n)
  return { n, min: Math.min(...values), p50: percentile(values, 50), p95: percentile(values, 95), max: Math.max(...values), mean }
}

/** Field-by-field equality report; every value compared as a string so bigint/number mixes are fine. */
export function diffFields(chain: Record<string, unknown>, ts: Record<string, unknown>): { equal: boolean; fields: Record<string, boolean> } {
  const norm = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : typeof x === 'number' ? String(x) : x))
  const fields: Record<string, boolean> = {}
  for (const key of Object.keys(ts)) fields[key] = norm(chain[key]) === norm(ts[key])
  return { equal: Object.values(fields).every(Boolean), fields }
}

export function payoutFor(stake: bigint, rank: number): bigint {
  return stake * MULTIPLIER_BPS[rank - 1]! / 10_000n
}

/** Full single-paragraph error text for reports (RPC details included); callers redact secrets before printing. */
export function describeError(error: unknown): string {
  const e = error as { shortMessage?: unknown; details?: unknown; message?: unknown } | null
  const parts = [e?.shortMessage, e?.details].filter((x): x is string => typeof x === 'string' && x.length > 0)
  const text = parts.length > 0 ? parts.join(' | ') : typeof e?.message === 'string' ? e.message : String(error)
  return text.replace(/\s+/g, ' ').slice(0, 600)
}

function json(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 1)
}

// ------------------------------------------------------------------------------------------------ runtime helpers

type TxFacts = {
  hash: Hex; block: bigint; timestamp: number; status: string; gasUsed: bigint; gasLimit: bigint
  effectiveGasPrice: bigint; from: Address; to: Address | null
}

type CallRecord = {
  label: string
  callId: string | null
  /** performance.now() axis */
  submitAt: number
  acceptedAt: number | null
  includedAt: number | null
  finalizedAt: number | null
  /** chain clock mid (Unix ms) when submitted */
  submitChainMs: number
  state: string
  txs: TxFacts[]
  prepared: Record<string, unknown> | null
}

/** CallAccount decorator that timestamps submit / call id / first non-pending status, same interface as the product. */
class TimedAccount implements CallAccount {
  readonly records: CallRecord[] = []
  private nextLabel = 'call'
  private nextPrepared: Record<string, unknown> | null = null

  constructor(private readonly inner: CallAccount, private readonly clock: ChainClock) {}

  label(label: string, prepared: Record<string, unknown> | null = null): void {
    this.nextLabel = label
    this.nextPrepared = prepared
  }

  getAddress(): Address | null {
    return this.inner.getAddress()
  }

  async send(calls: readonly ContractCall[]): Promise<string> {
    const submitAt = performance.now()
    const record: CallRecord = {
      label: this.nextLabel, callId: null, submitAt, acceptedAt: null, includedAt: null, finalizedAt: null,
      submitChainMs: this.clock.estimate(submitAt).mid, state: 'sending', txs: [], prepared: this.nextPrepared,
    }
    this.records.push(record)
    try {
      record.callId = await this.inner.send(calls)
      record.acceptedAt = performance.now()
      record.state = 'pending'
      return record.callId
    } catch (error) {
      record.state = `send-failed: ${errorReason(error)}`
      throw error
    }
  }

  async progress(callId: string): Promise<CallProgress> {
    const progress = await this.inner.progress(callId)
    const record = this.records.find((r) => r.callId === callId)
    if (record && record.includedAt === null && progress.state !== 'pending') {
      record.includedAt = performance.now()
      record.state = progress.state
    }
    return progress
  }
}

async function txFacts(pub: PublicClient, hash: Hex): Promise<TxFacts> {
  const [receipt, tx] = await Promise.all([pub.getTransactionReceipt({ hash }), pub.getTransaction({ hash })])
  const block = await pub.getBlock({ blockNumber: receipt.blockNumber })
  return {
    hash, block: receipt.blockNumber, timestamp: Number(block.timestamp), status: receipt.status, gasUsed: receipt.gasUsed,
    gasLimit: tx.gas, effectiveGasPrice: receipt.effectiveGasPrice, from: tx.from, to: tx.to,
  }
}

/** Poll the `finalized` tag until it covers `block`; returns the local time it was first seen, or null. */
async function waitFinalized(pub: PublicClient, block: bigint, timeoutMs = 20_000): Promise<number | null> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      const head = await pub.getBlock({ blockTag: 'finalized' })
      if (head.number !== null && head.number >= block) return performance.now()
    } catch {
      // next poll
    }
    await Bun.sleep(100)
  }
  return null
}

/** Enrich a finished record with its receipts and finality time. */
async function settleRecord(pub: PublicClient, record: CallRecord, hashes: readonly Hex[]): Promise<void> {
  for (const hash of hashes) record.txs.push(await txFacts(pub, hash))
  const last = record.txs.at(-1)
  if (last) record.finalizedAt = await waitFinalized(pub, last.block)
}

function preparedGas(result: unknown): Record<string, unknown> {
  const r = result as { type?: string; data?: unknown }
  const pick = (d: Record<string, unknown>) => Object.fromEntries(
    ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit',
      'paymasterPostOpGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'factory']
      .filter((k) => d[k] !== undefined).map((k) => [k, d[k]]),
  )
  if (Array.isArray(r.data)) {
    return { type: r.type, parts: r.data.map((p: { type?: string; data?: Record<string, unknown> }) => ({ type: p.type, ...pick(p.data ?? {}) })) }
  }
  return { type: r.type, ...pick((r.data ?? {}) as Record<string, unknown>) }
}

function slotsOf(choices: PaidChoiceFacts): PaidChoiceSlots {
  return choices.map((c) => (c
    ? { txSec: BigInt(c.txSec), cardId: c.cardId, refreshSlots: [...c.refreshSlots], anchor: c.anchor }
    : null)) as unknown as PaidChoiceSlots
}

function raceInputOf(facts: PaidSessionFacts): PaidRaceInput {
  return { seed: facts.seed, openAnchor: facts.openAnchor, stakeTier: facts.stakeTier, playerHorseId: facts.horseId, choices: slotsOf(facts.choices) }
}

/** Seconds s in [openSec, openSec + 19] at which the TS solver accepts `cardId` for checkpoint k. */
function legalSeconds(facts: PaidSessionFacts, k: 1 | 2 | 3, openSec: number, cardId: number): number[] {
  const core = derivePaidCoreInput(raceInputOf(facts))
  const out: number[] = []
  for (let s = openSec; s < openSec + 20; s++) {
    const choices = [...core.choices] as (PaidChoiceSlot | null)[]
    choices[k - 1] = { txSec: BigInt(s), cardId, refreshSlots: [], anchor: ZERO_HASH }
    try {
      if (Number(checkPaidChoice({ ...core, choices: choices as unknown as PaidChoiceSlots }, k)) === openSec) out.push(s)
    } catch {
      // not open / not manual at s
    }
  }
  return out
}

function tsResultFields(r: PaidSolveResult): Record<string, unknown> {
  return {
    finishTime: r.finishTime, finishWall: r.finishWall, rawOrder: r.rawOrder, settlementOrder: r.settlementOrder,
    playerRawRank: r.rawRank, playerSettlementRank: r.settlementRank, acquired: r.acquiredByCheckpoint,
    eventCount: r.eventCount, digest: r.digest,
  }
}

// ------------------------------------------------------------------------------------------------ main

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(readFileSync(import.meta.path, 'utf8').split('*/')[0])
    return
  }
  const cfg = parseSessionConfig(process.env, argv)
  const secrets = [cfg.apiKey, cfg.policyId].filter((s) => s.length >= 6)
  const redact = (text: string) => secrets.reduce((t, s) => t.split(s).join('[redacted]'), text)
  const log = (label: string, value: unknown = '') => console.log(redact(`${label}${value === '' ? '' : ` ${typeof value === 'string' ? value : json(value)}`}`))
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), mode: cfg.heavy ? 'heavy' : 'session', send: cfg.send }

  // player signer: only from its key file
  if (!existsSync(cfg.playerKeyPath)) {
    if (!cfg.createPlayer) throw new Error('MISSING_PLAYER_KEY (pass --create-player to generate one)')
    mkdirSync(resolve(cfg.playerKeyPath, '..'), { recursive: true, mode: 0o700 })
    writeFileSync(cfg.playerKeyPath, `${generatePrivateKey()}\n`, { mode: 0o600, flag: 'wx' })
    chmodSync(cfg.playerKeyPath, 0o600)
    log('created player key file (0600)', cfg.playerKeyPath)
  }
  const signer = privateKeyToAccount(readDeployerKey(cfg.playerKeyPath))

  const pub = createPublicClient({ chain: CHAIN, transport: http(cfg.rpcUrl) }) as PublicClient
  const chainId = await pub.getChainId()
  if (chainId !== CHAIN.id) throw new Error(`WRONG_CHAIN ${chainId}`)
  const wallet: SmartWalletClient = createSmartWalletClient({
    signer, chain: CHAIN, transport: alchemyWalletTransport({ apiKey: cfg.apiKey }),
  })
  const alchemy = new AlchemyAccount(wallet, signer.address, cfg.policyId)
  const sma = await alchemy.resolve()
  const clock = new ChainClock()
  const sync = startClockSync(pub, clock, { intervalMs: 1000 })
  const timed = new TimedAccount(alchemy, clock)
  const deps: PaidChainDeps = { account: timed, client: pub, game: cfg.game, vault: cfg.vault, poll: POLL, clock }
  const stake = PAID_STAKE_WEI[cfg.tier]
  log('player root', signer.address)
  log('player sma-b', sma)
  report.player = { root: signer.address, smaB: sma }

  const prepare = async (label: string, calls: readonly ContractCall[]): Promise<Record<string, unknown> | null> => {
    try {
      const out = preparedGas(await wallet.prepareCalls({
        account: sma, calls: [...calls], capabilities: { paymaster: { policyId: cfg.policyId } },
      }))
      log(`prepareCalls ${label}`, out)
      return out
    } catch (error) {
      log(`prepareCalls ${label} REJECTED`, redact(describeError(error)))
      return null
    }
  }
  const simulate = async (label: string, call: ContractCall): Promise<string | null> => {
    try {
      await pub.call({ account: sma, to: call.to, data: call.data, value: call.value })
      return null
    } catch (error) {
      const reason = errorReason(error)
      log(`eth_call ${label} reverted`, redact(describeError(error)))
      return reason
    }
  }
  const finish = async (record: CallRecord | undefined, hashes: readonly Hex[]) => {
    if (!record) return
    await settleRecord(pub, record, hashes)
    const tx = record.txs.at(-1)
    log(`  ${record.label}`, {
      callId: record.callId, state: record.state, tx: tx?.hash, block: tx?.block, timestamp: tx?.timestamp,
      gasUsed: tx?.gasUsed, txGasLimit: tx?.gasLimit,
      latencyMs: record.includedAt !== null ? Math.round(record.includedAt - record.submitAt) : null,
      finalizedAfterMs: record.finalizedAt !== null && record.includedAt !== null ? Math.round(record.finalizedAt - record.includedAt) : null,
    })
  }
  const lastRecord = () => timed.records.at(-1)

  try {
    // ------------------------------------------------------------ contract state
    const [solver, rulesetHash, entryPaused, boundVault, vaultGame, house, reserved, totalAvail, totalLocked, vaultBal] = await Promise.all([
      pub.readContract({ address: cfg.game, abi: extraGameAbi, functionName: 'solver' }),
      pub.readContract({ address: cfg.game, abi: ponyGameAbi, functionName: 'rulesetHash' }),
      pub.readContract({ address: cfg.game, abi: ponyGameAbi, functionName: 'entryPaused' }),
      pub.readContract({ address: cfg.game, abi: ponyGameAbi, functionName: 'vault' }),
      pub.readContract({ address: cfg.vault, abi: vaultStateAbi, functionName: 'game' }),
      pub.readContract({ address: cfg.vault, abi: vaultStateAbi, functionName: 'houseLiquidity' }),
      pub.readContract({ address: cfg.vault, abi: vaultStateAbi, functionName: 'reservedLiquidity' }),
      pub.readContract({ address: cfg.vault, abi: vaultStateAbi, functionName: 'totalAvailable' }),
      pub.readContract({ address: cfg.vault, abi: vaultStateAbi, functionName: 'totalLocked' }),
      pub.getBalance({ address: cfg.vault }),
    ])
    const state = {
      solver, rulesetHash, rulesetMatches: rulesetHash === PAID_RULESET_HASH, entryPaused,
      bound: isAddressEqual(boundVault, cfg.vault) && isAddressEqual(vaultGame, cfg.game),
      house, reserved, totalAvail, totalLocked, vaultBal,
      solvent: vaultBal >= totalAvail + totalLocked + house && house >= reserved,
    }
    log('contracts', state)
    report.contracts = state
    if (!state.rulesetMatches || !state.bound || !state.solvent) throw new Error('CONTRACT_STATE_MISMATCH')

    if (cfg.heavy) {
      report.heavy = await heavyProbe({ cfg, pub, sma, solver, timed, log, prepare, finish })
      return
    }

    // ------------------------------------------------------------ balances and session
    const funds0 = await readFunds(pub, cfg.vault, sma)
    const available0 = funds0.vault.state === 'ready' ? funds0.vault.available : 0n
    log('sma-b funds', { wallet: formatEther(funds0.wallet), vaultAvailable: formatEther(available0) })
    report.fundsBefore = { wallet: funds0.wallet, vaultAvailable: available0 }

    let facts: PaidSessionFacts | null = cfg.sessionId
      ? await readSessionFacts(pub, cfg.game, cfg.sessionId)
      : await recoverPaidSession(pub, cfg.game, sma)
    if (facts && facts.state !== SESSION_STATE.open) {
      log('session is not open', { sessionId: facts.sessionId, state: facts.state })
      facts = null
    }
    if (facts) log('recovered open session', { sessionId: facts.sessionId, player: facts.player, asPlayer: isAddressEqual(facts.player, sma) })

    if (!facts && cfg.open && !cfg.sessionId) {
      if (entryPaused) throw new Error('ENTRY_PAUSED')
      const shortfall = available0 >= stake ? 0n : stake - available0
      const topup = shortfall > funds0.wallet ? shortfall - funds0.wallet : 0n
      if (topup > cfg.maxTopup) throw new Error(`TOPUP_OVER_CAP ${formatEther(topup)} > ${formatEther(cfg.maxTopup)}`)
      if (topup > 0n) {
        if (!cfg.deployerKeyPath) throw new Error('MISSING_DEPLOYER_PRIVATE_KEY_PATH')
        const deployer = privateKeyToAccount(readDeployerKey(cfg.deployerKeyPath))
        const request = { account: deployer.address, to: sma, value: topup } as const
        const gas = await pub.estimateGas(request)
        const fees = await pub.estimateFeesPerGas()
        log('top-up simulated', { from: deployer.address, to: sma, value: formatEther(topup), gas, maxFeePerGas: fees.maxFeePerGas })
        if (cfg.send) {
          const nonce = await pub.getTransactionCount({ address: deployer.address, blockTag: 'pending' })
          const eoa = createWalletClient({ account: deployer, chain: CHAIN, transport: http(cfg.rpcUrl) })
          const hash = await eoa.sendTransaction({ to: sma, value: topup, gas, nonce, chainId: CHAIN.id, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas })
          const receipt = await pub.waitForTransactionReceipt({ hash })
          const tf = await txFacts(pub, hash)
          report.topup = { ...tf, value: topup, feeWei: tf.gasLimit * tf.effectiveGasPrice }
          log('top-up sent', { hash, block: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed, feeMON: formatEther(tf.gasLimit * tf.effectiveGasPrice) })
          if (receipt.status !== 'success') throw new Error('TOPUP_REVERTED')
        }
      }
      const calls = openSessionCalls(cfg.vault, cfg.game, cfg.horse, stake, shortfall)
      const walletNow = await pub.getBalance({ address: sma })
      const prepared = walletNow >= shortfall ? await prepare('deposit+openSession', calls) : null
      if (walletNow < shortfall) log('prepareCalls deposit+openSession skipped', `sma-b holds ${formatEther(walletNow)} < ${formatEther(shortfall)}; the top-up comes first`)
      if (!cfg.send) {
        log('simulate-only: pass --send to broadcast')
        return
      }
      if (!prepared) throw new Error('OPEN_NOT_PREPARED')
      timed.label('deposit+openSession', prepared)
      const opened = await openPaidSession(deps, cfg.horse, stake)
      await finish(lastRecord(), opened.hash ? [opened.hash] : [])
      facts = opened.facts
    }

    if (!facts) {
      await withdrawAll(cfg, pub, timed, prepare, finish, log, report)
      return
    }
    const asPlayer = isAddressEqual(facts.player, sma)
    report.session = { sessionId: facts.sessionId, horseId: facts.horseId, stakeTier: facts.stakeTier, seed: facts.seed, openedAt: facts.openedAt, openedBlock: facts.openedBlock, openAnchor: facts.openAnchor }
    log('session', report.session)
    const t0Ms = facts.openedAt * 1000
    const wall = (): WallRange => {
      const e = clock.estimate(performance.now())
      return { lo: e.lo - t0Ms, mid: e.mid - t0Ms, hi: e.hi - t0Ms }
    }

    // ------------------------------------------------------------ panels
    const plan = solveFromFacts(facts)
    log('TS plan at open', plan.checkpoints.map((c) => ({ k: c.checkpoint, reached: c.reached, mode: c.mode, openSec: c.openSec, candidates: c.candidates })))
    log('TS player finishWall (timeouts)', plan.finishWall[facts.horseId])
    const choiceLog: unknown[] = []
    for (const k of [1, 2, 3] as const) {
      const rec = solveFromFacts(facts).checkpoints[k - 1]!
      if (facts.choices[k - 1]) {
        choiceLog.push({ k, recovered: facts.choices[k - 1] })
        continue
      }
      if (!asPlayer) {
        choiceLog.push({ k, skipped: 'not the session player' })
        continue
      }
      if (!rec.reached || rec.mode !== 'manual') {
        choiceLog.push({ k, reached: rec.reached, mode: rec.mode, reason: rec.reason })
        log(`panel ${k} not manual`, { reached: rec.reached, mode: rec.mode, reason: rec.reason })
        continue
      }
      const openSec = Number(rec.openSec)
      const cardId = rec.candidates[0]!
      const legal = legalSeconds(facts, k, openSec, cardId)
      log(`panel ${k}`, { openSec, openWall: rec.openWall, candidates: rec.candidates, cardId, legalTxSec: legal.length ? `${legal[0]}..${legal.at(-1)} (${legal.length})` : 'none' })
      if (!cfg.send || legal.length === 0) {
        choiceLog.push({ k, openSec, cardId, legal, skipped: !cfg.send ? 'simulate-only' : 'no-legal-second' })
        continue
      }
      while (!(maySend(openSec, wall()) && wall().lo >= openSec * 1000 + cfg.chooseDelayMs)) {
        if (!acceptsClick(openSec, wall(), ALCHEMY_TIMING.marginMs)) break
        await Bun.sleep(50)
      }
      if (!acceptsClick(openSec, wall(), ALCHEMY_TIMING.marginMs)) {
        choiceLog.push({ k, openSec, cardId, skipped: 'window-closed-before-send' })
        continue
      }
      const call = chooseCardCall(cfg.game, facts.sessionId, k, cardId, [])
      let done = false
      const attempts: unknown[] = []
      while (!done && acceptsClick(openSec, wall(), ALCHEMY_TIMING.marginMs)) {
        const simWall = wall()
        const simError = await simulate(`chooseCard#${k}`, call)
        if (simError) {
          // an earlier attempt may have landed after all (e.g. InvalidCheckpoint): the chain record decides
          const landed = await readSessionFacts(pub, cfg.game, facts.sessionId).then((f) => f.choices[k - 1]).catch(() => null)
          if (landed) {
            const choices = [...facts.choices] as PaidChoiceFacts
            choices[k - 1] = landed
            facts = { ...facts, choices }
            choiceLog.push({ k, openSec, cardId, txSec: landed.txSec, adoptedFromChain: true, attempts })
            done = true
            continue
          }
          attempts.push({ simWallMid: Math.round(simWall.mid), simulation: simError })
          await Bun.sleep(400)
          continue
        }
        const prepared = await prepare(`chooseCard#${k}`, [call])
        if (!prepared) {
          attempts.push({ simWallMid: Math.round(simWall.mid), prepare: 'rejected' })
          await Bun.sleep(400)
          continue
        }
        if (!acceptsClick(openSec, wall(), ALCHEMY_TIMING.marginMs)) break
        const sendWall = wall()
        timed.label(`chooseCard#${k}`, prepared)
        const out = await choosePaidCard(deps, facts, k, cardId, [])
        await finish(lastRecord(), out.state !== 'unknown' && out.hash ? [out.hash] : [])
        if (out.state === 'included') {
          const choices = [...facts.choices] as PaidChoiceFacts
          choices[k - 1] = out.choice
          facts = { ...facts, choices }
          const entry = {
            k, openSec, cardId, txSec: out.choice.txSec, secAfterOpen: out.choice.txSec - openSec,
            legal: legal.includes(out.choice.txSec), sendWallMid: Math.round(sendWall.mid), block: out.choice.blockNumber,
            anchor: out.choice.anchor, hash: out.hash, attempts,
          }
          choiceLog.push(entry)
          log(`panel ${k} chosen`, entry)
          done = true
        } else if (out.state === 'rejected' && out.hash === null) {
          attempts.push({ sendWallMid: Math.round(sendWall.mid), rejectedBeforeSubmission: out.reason })
          await Bun.sleep(400)
        } else {
          // mined and reverted, or unknown: never resend blindly
          choiceLog.push({ k, openSec, cardId, outcome: out, attempts })
          log(`panel ${k} not recorded`, out)
          done = true
        }
      }
      if (!done) choiceLog.push({ k, openSec, cardId, skipped: 'window-closed', attempts })
    }
    report.choices = choiceLog

    // ------------------------------------------------------------ latency samples while the session is open
    const final = solveFromFacts(facts)
    const finishWall = Number(final.finishWall[facts.horseId])
    log('TS player finishWall', { finishWall, settleReadyWall: settleReadyWall(finishWall) })
    const previous = timed.records.length
    for (let i = 0; cfg.send && i < cfg.samples; i++) {
      const call = sealAnchorsCall(cfg.game, facts.sessionId)
      if (await simulate('sealAnchors', call)) break
      timed.label(`sealAnchors#${i + 1}`)
      let id: string
      try {
        id = await timed.send([call])
      } catch (error) {
        // e.g. the sponsorship policy refused this spender: stop sampling, keep the session going
        log('sealAnchors sample refused', redact(describeError(error)))
        report.samplesStopped = redact(describeError(error))
        break
      }
      const progress = await trackCall(timed, id, POLL)
      await finish(lastRecord(), progress.state === 'included' || progress.state === 'failed' ? progress.transactionHashes : [])
    }
    report.samplesSent = timed.records.length - previous

    if (!cfg.settle) {
      log('--no-settle: leaving the session open')
      return
    }

    // ------------------------------------------------------------ settlement
    if (wall().lo < settleReadyWall(finishWall)) log('waiting for the canonical finish on the chain clock')
    while (cfg.send && wall().lo < settleReadyWall(finishWall)) await Bun.sleep(100)
    facts = await readSessionFacts(pub, cfg.game, facts.sessionId)
    const onChainInput = await pub.readContract({ address: cfg.game, abi: extraGameAbi, functionName: 'raceInput', args: [facts.sessionId] })
    const tsInput: PaidRaceInput = {
      seed: onChainInput.seed, openAnchor: onChainInput.openAnchor, stakeTier: onChainInput.stakeTier as 1 | 2 | 3 | 4,
      playerHorseId: onChainInput.playerHorseId,
      choices: onChainInput.choices.map((c) => (c.present
        ? { txSec: BigInt(c.txSec), cardId: c.cardId, refreshSlots: [...c.refreshSlots], anchor: c.anchor }
        : null)) as unknown as PaidChoiceSlots,
    }
    const inputMatchesFacts = diffFields(tsInput as unknown as Record<string, unknown>, raceInputOf(facts) as unknown as Record<string, unknown>)
    const ts = solvePaidRace(tsInput, { trace: false })
    const [preview, previewPayout, settleableAt] = await pub.readContract({
      address: cfg.game, abi: ponyGameAbi, functionName: 'previewSettlement', args: [facts.sessionId],
    })
    const previewCheck = {
      ...diffFields(preview as unknown as Record<string, unknown>, tsResultFields(ts)),
      payout: previewPayout === payoutFor(stake, ts.settlementRank),
      settleableAt: settleableAt === BigInt(facts.openedAt) + (ts.finishWall[facts.horseId]! + 999n) / 1000n,
    }
    log('raceInput(view) equals receipt/getSession facts', inputMatchesFacts)
    log('previewSettlement vs solvePaidRace', previewCheck)
    report.preSettle = { raceInput: onChainInput, inputMatchesFacts, preview, previewPayout, settleableAt, ts: tsResultFields(ts), previewCheck }

    const settleCall = settleSessionCall(cfg.game, facts.sessionId)
    if (!cfg.send) {
      const simError = await simulate('settleSession', settleCall)
      report.settleSimulation = { reverted: simError, prepared: simError ? null : await prepare('settleSession', [settleCall]) }
      log('simulate-only: pass --send to settle and withdraw')
      return
    }
    let settled = null
    for (let attempt = 0; attempt < 12 && !settled; attempt++) {
      if (await simulate('settleSession', settleCall)) {
        await Bun.sleep(700)
        continue
      }
      const prepared = await prepare('settleSession', [settleCall])
      if (!prepared) {
        await Bun.sleep(700)
        continue
      }
      timed.label('settleSession', prepared)
      const out = await settlePaidSession(deps, facts)
      if (out.state === 'settled') {
        await finish(lastRecord(), out.settlement.hash ? [out.settlement.hash] : [])
        settled = out.settlement
      } else {
        log('settle attempt failed', out)
        if (out.state !== 'failed' || out.hash !== null || /sponsorship/i.test(out.reason)) break
        await Bun.sleep(700)
      }
    }
    if (!settled) throw new Error('SETTLE_FAILED')
    const settleCheck = diffFields(
      { finishTime: settled.finishTime, rawOrder: settled.rawOrder, settlementOrder: settled.settlementOrder, rank: settled.rank, payout: settled.payout, acquired: settled.acquired, digest: settled.digest },
      { finishTime: ts.finishTime, rawOrder: ts.rawOrder, settlementOrder: ts.settlementOrder, rank: ts.settlementRank, payout: payoutFor(stake, ts.settlementRank), acquired: ts.acquiredByCheckpoint, digest: ts.digest },
    )
    log('SessionSettled', settled)
    log('SessionSettled vs solvePaidRace', settleCheck)
    report.settlement = { event: settled, settleCheck }

    await withdrawAll(cfg, pub, timed, prepare, finish, log, report)
  } finally {
    sync.stop()
    const calls = timed.records.map((r) => ({
      label: r.label, callId: r.callId, state: r.state, prepared: r.prepared,
      latencyMs: r.includedAt !== null ? Math.round(r.includedAt - r.submitAt) : null,
      sendCallsMs: r.acceptedAt !== null ? Math.round(r.acceptedAt - r.submitAt) : null,
      blockTimeLatencyMs: r.txs.at(-1) ? r.txs.at(-1)!.timestamp * 1000 - Math.round(r.submitChainMs) : null,
      finalizedAfterMs: r.finalizedAt !== null && r.includedAt !== null ? Math.round(r.finalizedAt - r.includedAt) : null,
      txs: r.txs,
    }))
    report.calls = calls
    const lat = calls.filter((c) => c.state === 'included' && c.latencyMs !== null).map((c) => c.latencyMs!)
    const fin = calls.filter((c) => c.finalizedAfterMs !== null).map((c) => c.finalizedAfterMs!)
    const blockLat = calls.filter((c) => c.state === 'included' && c.blockTimeLatencyMs !== null).map((c) => c.blockTimeLatencyMs!)
    if (lat.length > 0) {
      report.latency = { submitToIncludedMs: stats(lat), includedToFinalizedMs: fin.length ? stats(fin) : null, submitToBlockTimestampMs: stats(blockLat), marginMs: ALCHEMY_TIMING.marginMs }
      log('latency', report.latency)
    }
    const fundsEnd = await readFunds(pub, cfg.vault, sma).catch(() => null)
    if (fundsEnd) report.fundsAfter = { wallet: fundsEnd.wallet, vaultAvailable: fundsEnd.vault.state === 'ready' ? fundsEnd.vault.available : null }
    report.finishedAt = new Date().toISOString()
    mkdirSync(cfg.outDir, { recursive: true })
    const out = resolve(cfg.outDir, `testnet-${report.mode}-${Date.now()}.json`)
    writeFileSync(out, redact(json(report)))
    log('report written', out)
  }
}

type Logger = (label: string, value?: unknown) => void
type Prepare = (label: string, calls: readonly ContractCall[]) => Promise<Record<string, unknown> | null>
type Finish = (record: CallRecord | undefined, hashes: readonly Hex[]) => Promise<void>

/** Withdraws the whole Vault available balance back to the sma-b wallet (product path: funds.withdrawFromVault). */
async function withdrawAll(
  cfg: SessionScriptConfig, pub: PublicClient, timed: TimedAccount, prepare: Prepare, finish: Finish, log: Logger,
  report: Record<string, unknown>,
): Promise<void> {
  const player = timed.getAddress()!
  const funds = await readFunds(pub, cfg.vault, player)
  const available = funds.vault.state === 'ready' ? funds.vault.available : 0n
  log('vault available before withdraw', formatEther(available))
  if (available === 0n) {
    report.withdraw = { skipped: 'nothing available' }
    return
  }
  const prepared = await prepare('withdraw', [withdrawCall(cfg.vault, available)])
  if (!cfg.send || !prepared) {
    report.withdraw = { simulated: available, prepared }
    return
  }
  timed.label('withdraw', prepared)
  const id = await withdrawFromVault(timed, funds, available)
  const progress = await trackCall(timed, id, POLL)
  await finish(timed.records.at(-1), progress.state === 'included' || progress.state === 'failed' ? progress.transactionHashes : [])
  report.withdraw = { amount: available, state: progress.state, availableAfter: await readVaultAvailable(pub, cfg.vault, player) }
}

type VectorSlot = { txSec: string; cardId: number; refreshSlots: number[]; anchor: Hex } | null
type VectorCase = { name: string; stopAtPanel?: number; input: { seed: Hex; openAnchor: Hex; playerHorseId: number; choices: VectorSlot[] }; expected: { stepCount: number; digest: Hex } }

/**
 * Heavy settlement on the sponsored path: batches of read-only `PaidRaceSolver.solve` calls sized to about 11M, 23M
 * and 29M call gas, estimated with prepareCalls. The heaviest vector uses hand-built profiles that `solve(RaceInput)`
 * cannot reproduce (it derives them from seed and anchor), so the heaviest *derived* vector is repeated instead.
 */
async function heavyProbe(ctx: {
  cfg: SessionScriptConfig; pub: PublicClient; sma: Address; solver: Address; timed: TimedAccount
  log: Logger; prepare: Prepare; finish: Finish
}): Promise<Record<string, unknown>> {
  const { cfg, pub, sma, solver, timed, log, prepare, finish } = ctx
  const vectors = JSON.parse(readFileSync(resolve(ROOT, 'tests/vectors/paid-race-v4.json'), 'utf8')) as { cases: VectorCase[] }
  const derived = vectors.cases.filter((c) => c.name.startsWith('derived-') && c.stopAtPanel === undefined)
  const heaviest = derived.reduce((a, b) => (b.expected.stepCount > a.expected.stepCount ? b : a))
  const index = Number(heaviest.name.slice('derived-'.length))
  const input = {
    seed: heaviest.input.seed, openAnchor: heaviest.input.openAnchor, stakeTier: index % 4 + 1, playerHorseId: heaviest.input.playerHorseId,
    choices: heaviest.input.choices.map((c) => (c
      ? { present: true, txSec: Number(c.txSec), cardId: c.cardId, refreshSlots: c.refreshSlots, anchor: c.anchor }
      : { present: false, txSec: 0, cardId: 0, refreshSlots: [], anchor: ZERO_HASH })) as never,
  }
  const data = encodeFunctionData({ abi: solverAbi, functionName: 'solve', args: [input] })
  const result = await pub.readContract({ address: solver, abi: solverAbi, functionName: 'solve', args: [input] })
  const solveGas = await pub.estimateGas({ account: sma, to: solver, data })
  log('heavy base call', { vector: heaviest.name, stepCount: heaviest.expected.stepCount, digestMatches: result.digest === heaviest.expected.digest, solveGas })
  const probes: Record<string, unknown>[] = []
  for (const target of [11_000_000, 23_000_000, 29_000_000]) {
    const n = Math.max(1, Math.round(target / Number(solveGas)))
    const calls = Array.from({ length: n }, () => ({ to: solver, data }))
    const estimate = solveGas * BigInt(n)
    const prepared = await prepare(`solve x${n} (~${(Number(estimate) / 1e6).toFixed(1)}M)`, calls)
    probes.push({ target, copies: n, approxCallGas: estimate, accepted: prepared !== null, prepared })
  }
  const report: Record<string, unknown> = { vector: heaviest.name, stepCount: heaviest.expected.stepCount, solveGas, probes }
  const pick = probes.filter((p) => p.accepted).sort((a, b) => Math.abs(Number(a.target) - 23e6) - Math.abs(Number(b.target) - 23e6))[0]
  if (cfg.send && pick) {
    const n = Number(pick.copies)
    timed.label(`heavy solve x${n}`, pick.prepared as Record<string, unknown>)
    const id = await timed.send(Array.from({ length: n }, () => ({ to: solver, data })))
    const progress = await trackCall(timed, id, POLL)
    await finish(timed.records.at(-1), progress.state === 'included' || progress.state === 'failed' ? progress.transactionHashes : [])
    report.sent = { copies: n, state: progress.state, txs: timed.records.at(-1)?.txs }
  }
  return report
}

if (import.meta.main) {
  main().then(() => process.exit(0)).catch((error: unknown) => {
    const apiKey = process.env.VITE_ALCHEMY_API_KEY ?? ''
    const policy = process.env.VITE_ALCHEMY_POLICY_ID ?? ''
    let text = describeError(error)
    for (const secret of [apiKey, policy]) if (secret) text = text.split(secret).join('[redacted]')
    console.error('fatal', text)
    process.exit(1)
  })
}
