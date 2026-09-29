/**
 * 真实资金：sma-b 钱包里的原生 MON，与 PonyVault 里该账户的可用余额（界面上的「游戏余额」）。
 *
 * - 两个数在**同一块高度**读取，只信 RPC 与合约，不信 Envio、不信浏览器算出的结算。
 * - Vault 地址未配置或该地址没有代码时返回 `not-deployed`，不把异常抛进界面。
 * - 充值 `deposit{value}` 与提款 `withdraw(amount)` 都经同一个 `CallAccount` 发出：
 *   运行时是 Alchemy sma-b（Gas 由策略代付），测试里是直接 EOA。
 */
import {
  encodeFunctionData,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import type { CallAccount, CallProgress, ContractCall } from './alchemy.ts'
import { vaultAbi } from './vault.ts'

export type VaultState =
  | { state: 'not-deployed'; reason: 'unset' | 'no-code' }
  | { state: 'ready'; address: Address; available: bigint }

export type FundsSnapshot = {
  readonly blockNumber: bigint
  readonly player: Address
  /** sma-b 自己持有的原生 MON */
  readonly wallet: bigint
  readonly vault: VaultState
}

export type FundsErrorCode =
  | 'vault-not-deployed'
  | 'invalid-amount'
  | 'insufficient-wallet'
  | 'insufficient-available'
  | 'account-not-resolved'
  | 'stale-funds'

export class FundsError extends Error {
  readonly code: FundsErrorCode
  constructor(code: FundsErrorCode, message: string = code) {
    super(message)
    this.name = 'FundsError'
    this.code = code
  }
}

type FundsReader = Pick<PublicClient, 'getBlockNumber' | 'getBalance' | 'getCode' | 'readContract'>

export async function readFunds(client: FundsReader, vault: Address | null, player: Address): Promise<FundsSnapshot> {
  // viem 默认把块高缓存约 4 秒；刚入块就刷新会钉在旧块上读出旧余额，所以这里不用缓存
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  if (!vault) {
    const wallet = await client.getBalance({ address: player, blockNumber })
    return { blockNumber, player, wallet, vault: { state: 'not-deployed', reason: 'unset' } }
  }
  const [wallet, code] = await Promise.all([
    client.getBalance({ address: player, blockNumber }),
    client.getCode({ address: vault, blockNumber }),
  ])
  if (!code || code === '0x') {
    return { blockNumber, player, wallet, vault: { state: 'not-deployed', reason: 'no-code' } }
  }
  const available = await client.readContract({
    address: vault, abi: vaultAbi, functionName: 'available', args: [player], blockNumber,
  })
  return { blockNumber, player, wallet, vault: { state: 'ready', address: vault, available } }
}

export function depositCall(vault: Address, amount: bigint): ContractCall {
  return { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'deposit' }), value: amount }
}

export function withdrawCall(vault: Address, amount: bigint): ContractCall {
  return { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'withdraw', args: [amount] }) }
}

/** 发交易前的本地校验：只防明显会失败的请求，最终以链上结果为准。 */
function readyVault(account: CallAccount, funds: FundsSnapshot, amount: bigint): Address {
  const address = account.getAddress()
  if (!address) throw new FundsError('account-not-resolved')
  if (!isAddressEqual(address, funds.player)) throw new FundsError('stale-funds')
  if (funds.vault.state !== 'ready') throw new FundsError('vault-not-deployed')
  if (amount <= 0n) throw new FundsError('invalid-amount')
  return funds.vault.address
}

/** sma-b 钱包 → Vault 可用余额。Gas 由赞助策略付，钱包余额可以整额充入。 */
export async function depositToVault(account: CallAccount, funds: FundsSnapshot, amount: bigint): Promise<string> {
  const vault = readyVault(account, funds, amount)
  if (amount > funds.wallet) throw new FundsError('insufficient-wallet')
  return account.send([depositCall(vault, amount)])
}

/** Vault 可用余额 → sma-b 钱包。 */
export async function withdrawFromVault(account: CallAccount, funds: FundsSnapshot, amount: bigint): Promise<string> {
  const vault = readyVault(account, funds, amount)
  if (funds.vault.state === 'ready' && amount > funds.vault.available) throw new FundsError('insufficient-available')
  return account.send([withdrawCall(vault, amount)])
}

export type TrackOptions = {
  pollMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onProgress?: (progress: CallProgress) => void
}

export type TrackResult = CallProgress | { state: 'timeout'; callId: string }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 轮询调用状态直到入块、失败或超时。单次查询出错按「还没结果」处理继续等；
 * 超时不是失败——交易可能已上链，调用方应提示玩家刷新余额核对。
 */
export async function trackCall(account: CallAccount, callId: string, opts: TrackOptions = {}): Promise<TrackResult> {
  const { pollMs = 1000, timeoutMs = 90_000, sleep = defaultSleep, now = Date.now, onProgress } = opts
  const deadline = now() + timeoutMs
  for (;;) {
    const progress = await account.progress(callId).catch(() => null)
    if (progress) {
      onProgress?.(progress)
      if (progress.state !== 'pending') return progress
    }
    if (now() >= deadline) return { state: 'timeout', callId }
    await sleep(pollMs)
  }
}

export type ReceiptResult = { state: 'success' | 'reverted'; hash: Hex } | { state: 'timeout'; hash: Hex }

/** 普通 EOA 交易（根账户迁入）的回执轮询，语义同 `trackCall`。 */
export async function trackTransaction(
  client: Pick<PublicClient, 'getTransactionReceipt'>, hash: Hex, opts: Omit<TrackOptions, 'onProgress'> = {},
): Promise<ReceiptResult> {
  const { pollMs = 1000, timeoutMs = 90_000, sleep = defaultSleep, now = Date.now } = opts
  const deadline = now() + timeoutMs
  for (;;) {
    try {
      const receipt = await client.getTransactionReceipt({ hash })
      return { state: receipt.status === 'success' ? 'success' : 'reverted', hash }
    } catch {
      // 还没入块（TransactionReceiptNotFoundError）与网络抖动同样处理：继续等到超时
    }
    if (now() >= deadline) return { state: 'timeout', hash }
    await sleep(pollMs)
  }
}
