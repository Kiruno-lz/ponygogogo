import { alchemyWalletTransport, createSmartWalletClient, type SmartWalletClient } from '@alchemy/wallet-apis'
import { isAddress, isAddressEqual, toFunctionSelector, zeroAddress, type Address, type Hex, type LocalAccount } from 'viem'
import { CHAIN } from './network.ts'

/** 我们实际用到的 Alchemy 钱包客户端子集；测试注入同形状的替身。 */
export type AccountClient = Pick<SmartWalletClient, 'requestAccount' | 'sendCalls' | 'getCallsStatus' | 'grantPermissions'>

function storageKey(root: Address): string {
  return `ponygogogo:sma-b:${CHAIN.id}:${root.toLowerCase()}`
}

function rememberedAddress(root: Address): Address | null {
  try {
    const stored = localStorage.getItem(storageKey(root))
    return stored && isAddress(stored) ? stored : null
  } catch {
    return null
  }
}

function rememberAddress(root: Address, address: Address): void {
  try {
    localStorage.setItem(storageKey(root), address)
  } catch {
    // Alchemy can recover the same address after a reload without local storage.
  }
}

export type ContractCall = { to: Address; data: Hex; value?: bigint }
export type CallProgress =
  | { state: 'pending'; callId: string }
  | { state: 'failed'; callId: string; transactionHashes: Hex[] }
  | { state: 'included'; callId: string; transactionHashes: Hex[] }

/**
 * 发交易的账户接口：sma-b 走 Alchemy 批量调用，测试用直接 EOA 实现同一接口，
 * 让资金模块在真实 EVM 语义下验证。**调用不得以账户自身为目标**——Modular Account V2
 * 在校验阶段拒绝空数据的自调用（Alchemy 报 AA23）。
 */
export interface CallAccount {
  getAddress(): Address | null
  send(calls: readonly ContractCall[]): Promise<string>
  progress(callId: string): Promise<CallProgress>
}

/** One Mera root owns one separate sma-b account on the configured chain. */
export class AlchemyAccount implements CallAccount {
  private address: Address | null = null
  private resolving: Promise<Address> | null = null

  constructor(
    private readonly client: AccountClient,
    private readonly rootAddress: Address,
    private readonly policyId = '',
  ) {}

  async resolve(): Promise<Address> {
    if (this.resolving) return this.resolving
    const pending = this.resolveOnce()
    this.resolving = pending
    try {
      return await pending
    } finally {
      if (this.resolving === pending) this.resolving = null
    }
  }

  private async resolveOnce(): Promise<Address> {
    const account = await this.client.requestAccount({
      signerAddress: this.rootAddress,
      creationHint: { accountType: 'sma-b', createAdditional: true },
    })
    if (isAddressEqual(account.address, this.rootAddress)) {
      throw new Error('ALCHEMY_RETURNED_ROOT_ACCOUNT')
    }
    if (this.address && !isAddressEqual(this.address, account.address)) {
      throw new Error('ALCHEMY_ACCOUNT_CHANGED')
    }
    const remembered = rememberedAddress(this.rootAddress)
    if (remembered && !isAddressEqual(remembered, account.address)) {
      throw new Error('ALCHEMY_ACCOUNT_CHANGED')
    }
    this.address = account.address
    rememberAddress(this.rootAddress, account.address)
    return account.address
  }

  getAddress(): Address | null {
    return this.address
  }

  /** The separate onchain budget is mandatory because selector scoping cannot sum stakes. */
  async grantAgentSession(game: Address, sessionKey: Address, expirySec: number): Promise<Hex> {
    if (!this.address) throw new Error('ALCHEMY_ACCOUNT_NOT_RESOLVED')
    if (!isAddress(game) || isAddressEqual(game, zeroAddress) || !isAddress(sessionKey)
      || isAddressEqual(sessionKey, zeroAddress) || isAddressEqual(sessionKey, this.rootAddress)
      || isAddressEqual(sessionKey, this.address)
      || !Number.isSafeInteger(expirySec) || expirySec <= Math.floor(Date.now() / 1000)) {
      throw new Error('INVALID_AGENT_PERMISSION')
    }
    const result = await this.client.grantPermissions({
      account: this.address,
      expirySec,
      key: { publicKey: sessionKey, type: 'secp256k1' },
      permissions: [{
        type: 'functions-on-contract',
        data: { address: game, functions: [toFunctionSelector('openAgentSession(uint8,uint256)')] },
      }],
    })
    return result.context
  }

  /** A call ID is not a transaction hash or proof of inclusion. */
  async send(calls: readonly ContractCall[]): Promise<string> {
    if (!this.address) throw new Error('ALCHEMY_ACCOUNT_NOT_RESOLVED')
    if (calls.length === 0) throw new Error('EMPTY_CALLS')
    if (!this.policyId) throw new Error('ALCHEMY_POLICY_ID_REQUIRED')
    const result = await this.client.sendCalls({
      account: this.address,
      calls: [...calls],
      capabilities: { paymaster: { policyId: this.policyId } },
    })
    return result.id
  }

  async progress(callId: string): Promise<CallProgress> {
    const result = await this.client.getCallsStatus({ id: callId })
    const transactionHashes = (result.receipts ?? []).map((receipt) => receipt.transactionHash)
    if (result.status === 'failure' || result.receipts?.some((receipt) => receipt.status === 'reverted')) {
      return { state: 'failed', callId, transactionHashes }
    }
    if (result.status === 'success' && result.receipts?.length && result.receipts.every((receipt) => receipt.status === 'success')) {
      return { state: 'included', callId, transactionHashes }
    }
    return { state: 'pending', callId }
  }
}

/**
 * Gas Manager 策略的赞助额度用完（如 `Policy's max count per spender exceeded`）。它在 sendCalls 时才到，
 * prepareCalls 不报；重发只会再被拒，所以调用方不得自动重试，只给玩家一条明确的说明。
 */
const SPONSOR_QUOTA_RE = /\bpolicy'?s max (?:count|spend)\b[^\n]*\bexceeded\b/i

export function isSponsorQuotaError(err: unknown): boolean {
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur !== null && cur !== undefined && !seen.has(cur)) {
    seen.add(cur)
    if (typeof cur === 'string') return SPONSOR_QUOTA_RE.test(cur)
    if (typeof cur !== 'object') return false
    const e = cur as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown }
    if ([e.details, e.shortMessage, e.message].some((v) => typeof v === 'string' && SPONSOR_QUOTA_RE.test(v))) return true
    cur = e.cause
  }
  return false
}

export function createAlchemyAccount(signer: LocalAccount<'mera'>, apiKey: string, policyId: string): AlchemyAccount {
  if (!apiKey) throw new Error('ALCHEMY_API_KEY_REQUIRED')
  const client = createSmartWalletClient({
    signer,
    chain: CHAIN,
    transport: alchemyWalletTransport({ apiKey }),
  })
  return new AlchemyAccount(client, signer.address, policyId)
}
