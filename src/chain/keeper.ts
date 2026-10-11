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

export const STATE_OPEN = 1
export const HISTORY_WINDOW = 8191n
export const FORFEIT_ANCHOR_LOST = 1
export const FORFEIT_SOLVER_FAULT = 2
/** Reason-2 forfeits must leave the probe FORFEIT_PROBE_GAS (29M) plus the 63/64 margin; Monad caps a tx at 30M. */
export const SOLVER_FAULT_GAS = 29_700_000n

const SESSION_OPENED =
  'event SessionOpened(bytes32 indexed sessionId, address indexed player, uint8 horseId, uint256 stake, bytes32 seed, uint64 openedAt, uint64 openedBlock, bytes32 rulesetHash, uint8[5] roster)'
export const sessionOpenedEvent = parseAbiItem(SESSION_OPENED)

export const keeperGameAbi = parseAbi([
  'struct ChoiceView { bool present; uint32 txSec; uint64 blockNumber; uint8 cardId; uint8[] refreshSlots; bytes32 anchor; }',
  'struct SessionView { address player; uint8 state; uint8 playerHorseId; uint8 stakeTier; uint256 stake; uint64 openedAt; uint64 openedBlock; bytes32 seed; bytes32 openAnchor; uint8 lastCheckpoint; ChoiceView[3] choices; uint8[5] roster; }',
  'function rulesetHash() view returns (bytes32)',
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

export type KeeperCheckpoint = { cursor: string; sessions: Hex[] }

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

export function formatAction(action: KeeperAction | KeeperReport | Record<string, unknown>): string {
  return JSON.stringify(action, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))
}

export async function createKeeper(config: KeeperConfig, options: { account?: PrivateKeyAccount; checkpoint?: KeeperCheckpoint; maxScanBlocks?: bigint } = {}) {
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
    config.send ? options.account ?? null : null
  if (config.send && !account) throw new Error('MISSING_KEEPER_ACCOUNT')
  const wallet = account ? createWalletClient({ account, chain, transport: http(config.rpcUrl) }) : null
  const watched = new Set<Hex>(options.checkpoint?.sessions ?? [])
  let cursor = options.checkpoint ? BigInt(options.checkpoint.cursor) : config.fromBlock
  const game = config.game

  async function scan(latestBlock: bigint): Promise<void> {
    const end = options.maxScanBlocks && cursor + options.maxScanBlocks - 1n < latestBlock ? cursor + options.maxScanBlocks - 1n : latestBlock
    for (let from = cursor; from <= end; from += config.logChunk) {
      const to = from + config.logChunk - 1n < end ? from + config.logChunk - 1n : end
      const logs = await publicClient.getLogs({
        address: game,
        events: [sessionOpenedEvent],
        fromBlock: from,
        toBlock: to,
      })
      for (const log of logs) {
        if (log.args.sessionId) watched.add(log.args.sessionId)
      }
    }
    if (end + 1n > cursor) cursor = end + 1n
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

  return { runOnce, chainId, sender: account?.address ?? null, checkpoint: (): KeeperCheckpoint => ({ cursor: cursor.toString(), sessions: [...watched] }) }
}

