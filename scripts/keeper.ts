/**
 * 保管人回收脚本（会话协议 v2，项目方决定：不设退款）：扫描 PonyGame 的 SessionOpened，找出仍开放的会话。
 * 保管人从不代玩家结算，也不为玩家封锚——结算是玩家自己的权益。玩家规范冲线（`previewSettlement` 的
 * `settleableAt`）加宽限期后仍未结算的会话，等 `canForfeit` 为真再 `forfeitSession` 回收（返还 0，下注进庄家流动性、
 * 释放预留）：原因 1 = 某个所需锚未封存且已过 EIP-2935 窗口（任何人可调）；原因 2 = T0 后 1 天、锚可读而求时器回退
 * （只有 owner，交易须给探测留足 FORFEIT_PROBE_GAS）。发送前一律 eth_call 模拟，模拟失败只报告不发。
 * 锚过窗至少要 8192 块（约 47 分钟），远长于任何一场比赛的现实时长（≤ 约 11 分钟）加默认宽限，故原因 1 可回收时
 * 玩家必然早已冲线且过了宽限期。
 *
 * 默认 dry-run：只打印将要做的动作，不读取密钥文件（模拟原因 2 时以 owner 地址作 eth_call 发送方）；`--send`（或
 * KEEPER_SEND=1）才读取 DEPLOYER_PRIVATE_KEY_PATH 的密钥发交易。注意 Bun 会自动加载仓库根目录的 .env（其中
 * ETH_RPC_URL 指向 Monad 测试网、DEPLOYER_PRIVATE_KEY_PATH 指向真实部署密钥），本地调试务必显式设置 KEEPER_RPC_URL。
 * 时间一律取链上最新块的 timestamp，与合约的 `block.timestamp - T0` 同一时钟。
 *
 * 用法：
 *   PONY_GAME=0x... KEEPER_FROM_BLOCK=123 bun scripts/keeper.ts            # dry-run，扫一次
 *   PONY_GAME=0x... bun scripts/keeper.ts --send --loop                    # 常驻发送
 *
 * 环境变量：KEEPER_RPC_URL（缺省 ETH_RPC_URL）、PONY_GAME、KEEPER_FROM_BLOCK（缺省 0，填 Game 部署块）、
 * KEEPER_GRACE_SEC（缺省 60）、KEEPER_LOG_CHUNK（缺省 100，每次 eth_getLogs 的块数）、KEEPER_POLL_MS（缺省 5000）、
 * KEEPER_SEND=1、DEPLOYER_PRIVATE_KEY_PATH。
 */
import { readFileSync } from 'node:fs'
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const STATE_OPEN = 1
export const HISTORY_WINDOW = 8191n
export const FORFEIT_ANCHOR_LOST = 1
export const FORFEIT_SOLVER_FAULT = 2
/** Reason-2 forfeits must leave the probe FORFEIT_PROBE_GAS (29M) plus the 63/64 margin; Monad caps a tx at 30M. */
export const SOLVER_FAULT_GAS = 29_700_000n

const SESSION_OPENED =
  'event SessionOpened(bytes32 indexed sessionId, address indexed player, uint8 horseId, uint256 stake, bytes32 seed, uint64 openedAt, uint64 openedBlock, bytes32 rulesetHash)'
export const sessionOpenedEvent = parseAbiItem(SESSION_OPENED)

export const keeperGameAbi = parseAbi([
  'struct ChoiceView { bool present; uint32 txSec; uint64 blockNumber; uint8 cardId; uint8[] refreshSlots; bytes32 anchor; }',
  'struct SessionView { address player; uint8 state; uint8 playerHorseId; uint8 stakeTier; uint256 stake; uint64 openedAt; uint64 openedBlock; bytes32 seed; bytes32 openAnchor; uint8 lastCheckpoint; ChoiceView[3] choices; }',
  'struct RaceResult { uint32[5] finishTime; uint32[5] finishWall; uint8[5] rawOrder; uint8[5] settlementOrder; uint8 playerRawRank; uint8 playerSettlementRank; uint8[3] acquired; uint32 eventCount; bytes32 digest; }',
  SESSION_OPENED,
  'function getSession(bytes32 sessionId) view returns (SessionView)',
  'function previewSettlement(bytes32 sessionId) view returns (RaceResult result, uint256 payout, uint256 settleableAt)',
  'function canForfeit(bytes32 sessionId) view returns (bool, uint8)',
  'function forfeitSession(bytes32 sessionId)',
  'function owner() view returns (address)',
  'error AnchorUnavailable()',
  'error UnknownSession()',
  'error SessionNotOpen()',
  'error InvalidSolverResult()',
  'error ForfeitNotAllowed()',
  'error ForfeitTooEarly(uint256 availableAt)',
  'error ForfeitProbeGasTooLow()',
])

export interface KeeperConfig {
  rpcUrl: string
  game: Address
  fromBlock: bigint
  graceSec: bigint
  logChunk: bigint
  send: boolean
  keyPath: string | null
  loop: boolean
  pollMs: number
}

/**
 * wait: the player may still settle (settleableAt is null while the preview reverts, e.g. a solver fault before the
 * 1-day delay); lostAtBlock is the first block at which an unsealed required anchor is lost (null when all are sealed,
 * so the session never becomes forfeitable for reason 1). forfeit: sent, or only simulated in dry-run. blocked:
 * forfeitable but the simulation from this sender fails (reason 2 needs the owner key).
 */
export type KeeperAction =
  | { kind: 'wait'; sessionId: Hex; settleableAt: bigint | null; readyAt: bigint | null; lostAtBlock: bigint | null }
  | { kind: 'forfeit'; sessionId: Hex; reason: number; dryRun: boolean; txHash?: Hex; gasUsed?: bigint }
  | { kind: 'blocked'; sessionId: Hex; reason: number; error: string }
  | { kind: 'failed'; sessionId: Hex; step: 'forfeit'; reason: string }

export interface KeeperReport {
  latestBlock: bigint
  now: bigint
  watched: number
  actions: KeeperAction[]
}

/** The anchor-bearing part of getSession the keeper reasons about. */
export interface AnchorFacts {
  openedBlock: bigint
  openAnchor: Hex
  choices: readonly { present: boolean; blockNumber: bigint; anchor: Hex }[]
}

const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

function positiveBigint(raw: string | undefined, fallback: bigint, name: string): bigint {
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`INVALID_${name}`)
  return BigInt(raw)
}

export function parseConfig(env: Record<string, string | undefined>, argv: readonly string[]): KeeperConfig {
  const rpcUrl = env.KEEPER_RPC_URL || env.ETH_RPC_URL || ''
  if (!/^https?:\/\//.test(rpcUrl)) throw new Error('INVALID_RPC_URL')
  const game = env.PONY_GAME ?? ''
  if (!isAddress(game)) throw new Error('INVALID_PONY_GAME')
  const logChunk = positiveBigint(env.KEEPER_LOG_CHUNK, 100n, 'LOG_CHUNK')
  if (logChunk < 1n) throw new Error('INVALID_LOG_CHUNK')
  const send = argv.includes('--send') || env.KEEPER_SEND === '1'
  const keyPath = env.DEPLOYER_PRIVATE_KEY_PATH || null
  if (send && !keyPath) throw new Error('MISSING_DEPLOYER_PRIVATE_KEY_PATH')
  return {
    rpcUrl,
    game,
    fromBlock: positiveBigint(env.KEEPER_FROM_BLOCK, 0n, 'FROM_BLOCK'),
    graceSec: positiveBigint(env.KEEPER_GRACE_SEC, 60n, 'GRACE_SEC'),
    logChunk,
    send,
    keyPath,
    loop: argv.includes('--loop'),
    pollMs: Number(positiveBigint(env.KEEPER_POLL_MS, 5000n, 'POLL_MS')),
  }
}

/** Reads a 0x-prefixed 32-byte key; the error never echoes file content. */
export function readDeployerKey(path: string): Hex {
  const raw = readFileSync(path, 'utf8').trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('INVALID_DEPLOYER_KEY')
  return raw as Hex
}

/** The player's settlement is overdue once its canonical finish is at least `graceSec` old on the chain clock. */
export function isOverdue(now: bigint, settleableAt: bigint, graceSec: bigint): boolean {
  return now >= settleableAt + graceSec
}

/** Source blocks of required anchors that are still unsealed. */
export function unsealedAnchorBlocks(session: AnchorFacts): bigint[] {
  const blocks: bigint[] = []
  if (session.openAnchor === ZERO_HASH) blocks.push(session.openedBlock)
  for (const choice of session.choices) {
    if (choice.present && choice.anchor === ZERO_HASH) blocks.push(choice.blockNumber)
  }
  return blocks
}

/** First block at which an unsealed required anchor is no longer readable (age 8192), or null when all are sealed. */
export function anchorLostAt(session: AnchorFacts): bigint | null {
  const blocks = unsealedAnchorBlocks(session)
  if (blocks.length === 0) return null
  return blocks.reduce((a, b) => (b < a ? b : a)) + HISTORY_WINDOW + 1n
}

export function revertReason(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.signature ?? reverted.reason ?? reverted.shortMessage
    }
    return error.shortMessage
  }
  return error instanceof Error ? error.message : String(error)
}

export function formatAction(action: KeeperAction | Record<string, unknown>): string {
  return JSON.stringify(action, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))
}

export async function createKeeper(config: KeeperConfig) {
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) })
  const chainId = await publicClient.getChainId()
  const chain = defineChain({
    id: chainId,
    name: `keeper-${chainId}`,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  })
  // Dry-run never touches the key file: simulation of permissionless calls needs no sender.
  const account: PrivateKeyAccount | null =
    config.send && config.keyPath ? privateKeyToAccount(readDeployerKey(config.keyPath)) : null
  const wallet = account ? createWalletClient({ account, chain, transport: http(config.rpcUrl) }) : null
  const watched = new Set<Hex>()
  let cursor = config.fromBlock
  const game = config.game

  async function scan(latestBlock: bigint): Promise<void> {
    for (let from = cursor; from <= latestBlock; from += config.logChunk) {
      const to = from + config.logChunk - 1n < latestBlock ? from + config.logChunk - 1n : latestBlock
      const logs = await publicClient.getLogs({
        address: game,
        event: sessionOpenedEvent,
        fromBlock: from,
        toBlock: to,
      })
      for (const log of logs) {
        if (log.args.sessionId) watched.add(log.args.sessionId)
      }
    }
    if (latestBlock + 1n > cursor) cursor = latestBlock + 1n
  }

  /** Simulates forfeitSession from the sender that would send it, then sends only with --send. */
  async function forfeit(sessionId: Hex, reason: number, actions: KeeperAction[]): Promise<boolean> {
    const gas = reason === FORFEIT_SOLVER_FAULT ? SOLVER_FAULT_GAS : undefined
    let simulated
    try {
      // Dry-run simulates reason 2 as the owner would send it; reason 1 is permissionless.
      const from = account?.address ?? (reason === FORFEIT_SOLVER_FAULT
        ? await publicClient.readContract({ address: game, abi: keeperGameAbi, functionName: 'owner' })
        : undefined)
      simulated = await publicClient.simulateContract({
        address: game, abi: keeperGameAbi, functionName: 'forfeitSession', args: [sessionId], account: account ?? from, gas,
      })
    } catch (error) {
      actions.push({ kind: 'blocked', sessionId, reason, error: revertReason(error) })
      return false
    }
    if (!config.send || !wallet) {
      actions.push({ kind: 'forfeit', sessionId, reason, dryRun: true })
      return false
    }
    try {
      const txHash = await wallet.writeContract({ ...simulated.request, gas })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status !== 'success') {
        actions.push({ kind: 'failed', sessionId, step: 'forfeit', reason: `reverted in ${txHash}` })
        return false
      }
      actions.push({ kind: 'forfeit', sessionId, reason, dryRun: false, txHash, gasUsed: receipt.gasUsed })
      return true
    } catch (error) {
      actions.push({ kind: 'failed', sessionId, step: 'forfeit', reason: revertReason(error) })
      return false
    }
  }

  /** Never settles or seals for the player: an open session either waits or, once forfeitable, is forfeited. */
  async function runOnce(): Promise<KeeperReport> {
    const latest = await publicClient.getBlock({ blockTag: 'latest' })
    await scan(latest.number)
    const actions: KeeperAction[] = []
    for (const sessionId of [...watched]) {
      const session = await publicClient.readContract({
        address: game, abi: keeperGameAbi, functionName: 'getSession', args: [sessionId],
      })
      if (session.state !== STATE_OPEN) {
        watched.delete(sessionId)
        continue
      }
      let settleableAt: bigint | null = null
      try {
        const [, , at] = await publicClient.readContract({
          address: game, abi: keeperGameAbi, functionName: 'previewSettlement', args: [sessionId],
        })
        settleableAt = at
      } catch {
        // Anchor pending or lost, or the solver fails: canForfeit decides below.
      }
      const lostAtBlock = anchorLostAt(session)
      const readyAt = settleableAt === null ? null : settleableAt + config.graceSec
      const overdue = settleableAt === null || isOverdue(latest.timestamp, settleableAt, config.graceSec)
      const [forfeitable, reason] = overdue
        ? await publicClient.readContract({ address: game, abi: keeperGameAbi, functionName: 'canForfeit', args: [sessionId] })
        : [false, 0]
      if (!forfeitable) {
        actions.push({ kind: 'wait', sessionId, settleableAt, readyAt, lostAtBlock })
        continue
      }
      if (await forfeit(sessionId, reason, actions)) watched.delete(sessionId)
    }
    return { latestBlock: latest.number, now: latest.timestamp, watched: watched.size, actions }
  }

  return { runOnce, sender: account?.address ?? null }
}

const USAGE = `usage: PONY_GAME=0x... [KEEPER_FROM_BLOCK=n] bun scripts/keeper.ts [--send] [--loop]
  dry-run unless --send or KEEPER_SEND=1; see the header of scripts/keeper.ts for every variable`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return
  }
  const config = parseConfig(process.env, argv)
  const keeper = await createKeeper(config)
  for (;;) {
    const report = await keeper.runOnce()
    for (const action of report.actions) console.log(formatAction(action))
    console.log(formatAction({
      kind: 'summary', dryRun: !config.send, sender: keeper.sender, latestBlock: report.latestBlock,
      now: report.now, watched: report.watched, actions: report.actions.length,
    }))
    if (!config.loop) return
    await new Promise((resolve) => setTimeout(resolve, config.pollMs))
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(formatAction({ kind: 'fatal', reason: revertReason(error) }))
    process.exit(1)
  })
}
