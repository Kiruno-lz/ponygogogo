/**
 * 通行密钥钱包。项目里唯一持有账户身份的地方——ChainPort 只管一局比赛的进出账，
 * 不再知道「谁」在玩。
 *
 * 注册：创建一把 rpId 下的通行密钥（名字由玩家自己起）→ 取 PRF 输出 → 派生账户 → 领测试币。
 * 登录：唤起某一把通行密钥的断言 → 同一个 PRF 输出 → 同一个地址。
 * 登出：结束签名会话把私钥清零，账户从内存里移除。
 *
 * **一个 rpId 下可以有多把通行密钥，每把对应一个独立账户。** 登录不限定凭据，由系统自己
 * 列出全部让玩家挑；哪一把派生出了当前账户只记在内存里，导出助记词必须重新验证同一把，
 * 验错了会导出成另一个钱包。
 *
 * **这个模块不往持久存储里写任何东西。** 密钥在认证器里，玩家起的名字也在认证器里，
 * 浏览器这边除了内存中的会话什么都不留；刷新页面即回到未登录。
 */
import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
  type EvmAddress,
  type PasskeyCredentialTransport,
  type Secp256k1SigningSession,
  type WebAuthnClient,
} from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import { createPublicClient, http, type LocalAccount, type PublicClient, type Transport } from 'viem'
import { accountFromMnemonic, mnemonicFromPrf, shortAddress } from './derive.ts'
import { claimFaucet, type FaucetResult } from './faucet.ts'
import { CHAIN, DEFAULT_PASSKEY_NAME, RPC_URL, RP_NAME, defaultRpId } from './network.ts'

/** 名字只是认证器列表里的标签，别让它长到撑爆系统弹窗 */
const MAX_NAME_LEN = 32

export type WalletAccount = {
  readonly address: EvmAddress
  /** 地址摘要，界面短展示用 */
  readonly label: string
}

/** 派生出当前账户的那把通行密钥，只够再发起一次断言用。仅存在于内存。 */
type ActiveCredential = {
  readonly credentialId: string
  readonly transports?: readonly PasskeyCredentialTransport[]
}

export type RegisterOptions = {
  /** 通行密钥在认证器里显示的用户名；留空用默认名 */
  userName?: string
  /** 派生出地址的那一刻回调一次，让界面先画出来，别等领水 */
  onAccount?: (account: WalletAccount) => void
}

export type RegisterOutcome = {
  readonly account: WalletAccount
  readonly faucet: FaucetResult
  /** 领水后（或超时后）读到的余额 */
  readonly balance: bigint
  /**
   * 余额是否真的涨了。水龙头收下请求（`faucet.ok`）只说明它受理了，不等于已经入账；
   * 界面要据此区分「已到账」和「已提交，稍后刷新」，不能拿受理当到账。
   */
  readonly funded: boolean
}

/** 界面要按类别给出不同的引导，所以错误必须是可判别的码，不是一句话。 */
export type WalletErrorCode =
  | 'unsupported' // 环境没有 WebAuthn
  | 'insecure-host' // 用 IP 或非安全上下文访问：WebAuthn 的 rpId 只接受 localhost 或真实域名
  | 'cancelled' // 用户取消或认证器不可用
  | 'no-prf' // 认证器不支持 PRF 扩展
  | 'no-crypto' // 运行时缺 Web Crypto
  | 'locked' // 未登录就调用了需要会话的操作
  | 'unknown'

export class WalletError extends Error {
  readonly code: WalletErrorCode
  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WalletError'
    this.code = code
  }
}

export type WalletDeps = {
  rpId?: string
  /** 注入的 WebAuthn 客户端；不传就用浏览器原生的 navigator.credentials */
  webAuthnClient?: WebAuthnClient
  /** 注入的 viem transport；不传就按 RPC_URL 走 http */
  transport?: Transport
  fetchImpl?: typeof fetch
  /** 领水后的余额轮询节奏；测试注入 0 间隔，运行时用默认值 */
  fundingPoll?: { tries: number; gapMs: number }
}

function toWalletError(err: unknown): WalletError {
  if (err instanceof WalletError) return err
  if (isMeraError(err)) {
    switch (err.code) {
      case 'PRF_UNAVAILABLE':
        return new WalletError('no-prf', err.message, { cause: err })
      case 'CRYPTO_UNAVAILABLE':
        return new WalletError('no-crypto', err.message, { cause: err })
      case 'PASSKEY_OPERATION_FAILED':
        return new WalletError('cancelled', err.message, { cause: err })
      default:
        return new WalletError('unknown', err.message, { cause: err })
    }
  }
  return new WalletError('unknown', err instanceof Error ? err.message : String(err), { cause: err })
}

/** IPv4 字面量或 IPv6（含冒号）都不是合法的 WebAuthn rpId */
function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/** 名字去掉首尾空白并截断；全空就回落到默认名，认证器列表里不留一个空条目 */
function normalizeName(name: string | undefined): string {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LEN)
  return trimmed.length > 0 ? trimmed : DEFAULT_PASSKEY_NAME
}

export class MeraWallet {
  private readonly rpId: string
  private readonly webAuthnClient: WebAuthnClient | undefined
  private readonly fetchImpl: typeof fetch | undefined
  private readonly client: PublicClient
  private readonly fundingPoll: { tries: number; gapMs: number }

  private session: Secp256k1SigningSession | null = null
  private signer: LocalAccount<'mera'> | null = null
  private account: WalletAccount | null = null
  /** 当前账户由哪一把通行密钥派生；导出助记词必须验证同一把 */
  private activeCredential: ActiveCredential | null = null

  constructor(deps: WalletDeps = {}) {
    this.rpId = deps.rpId ?? defaultRpId()
    this.webAuthnClient = deps.webAuthnClient
    this.fetchImpl = deps.fetchImpl
    this.client = createPublicClient({ chain: CHAIN, transport: deps.transport ?? http(RPC_URL) })
    this.fundingPoll = deps.fundingPoll ?? { tries: 15, gapMs: 1000 }
  }

  /** 已登录的账户；未登录为 null。刷新页面即回到未登录。 */
  getAccount(): WalletAccount | null {
    return this.account
  }

  /** 供将来的 enterRace / settleRace 签名使用；未登录时为 null。 */
  getSigner(): LocalAccount<'mera'> | null {
    return this.signer
  }

  /**
   * 注册：创建通行密钥 → 派生账户 → 领测试币 → 读余额。领水失败不影响注册成功。
   *
   * 领水要等链上入账，最坏十几秒。`onAccount` 在派生出地址的那一刻就回调一次，
   * 让界面先把钱包画出来，余额随后落位——否则注册按钮会停在「创建中」看起来像卡死。
   */
  async register({ userName, onAccount }: RegisterOptions = {}): Promise<RegisterOutcome> {
    this.requireWebAuthn()
    const name = normalizeName(userName)
    let prfOutput: Uint8Array | null = null
    try {
      const created = await createPasskeyWithPrfOutput({
        rp: { id: this.rpId, name: RP_NAME },
        user: { name, displayName: name },
        ...(this.webAuthnClient ? { webAuthnClient: this.webAuthnClient } : {}),
      })
      prfOutput = created.prfOutput
      const account = this.adopt(prfOutput, {
        credentialId: created.credentialId,
        ...(created.transports ? { transports: created.transports } : {}),
      })
      onAccount?.(account)
      const before = await this.readBalance(account.address).catch(() => 0n)
      // 按地址领，不读 this.account：轮询期间玩家可能已经退出，那时注册流程仍要走完
      const faucet = await this.requestFaucet(account.address)
      const balance = faucet.ok ? await this.waitForFunding(account.address, before) : before
      return { account, faucet, balance, funded: balance > before }
    } catch (err) {
      throw toWalletError(err)
    } finally {
      prfOutput?.fill(0)
    }
  }

  /**
   * 登录：唤起通行密钥断言，拿回同一个 PRF 输出，派生出同一个地址。
   *
   * **断言不做限定**，由系统自己列出该域名下的全部通行密钥让玩家挑——这样一把设备上
   * 有多个账户时不需要我们再画一个选择界面，从另一台设备同步过来、本机没有记录的
   * 密钥也走同一条路。选中哪把以平台返回的凭据为准。
   */
  async login(): Promise<WalletAccount> {
    this.requireWebAuthn()
    let prfOutput: Uint8Array | null = null
    try {
      const asserted = await getPasskeyPrfOutput({
        rpId: this.rpId,
        ...(this.webAuthnClient ? { webAuthnClient: this.webAuthnClient } : {}),
      })
      prfOutput = asserted.prfOutput
      // 以平台实际返回的凭据为准：系统弹窗里玩家挑了哪一把由它说了算
      return this.adopt(prfOutput, { credentialId: asserted.credentialId })
    } catch (err) {
      throw toWalletError(err)
    } finally {
      prfOutput?.fill(0)
    }
  }

  /** 登出：私钥清零，账户从内存里移除；本地只留凭据 ID。 */
  logout(): void {
    this.session?.end()
    this.session = null
    this.signer = null
    this.account = null
    this.activeCredential = null
  }

  async refreshBalance(): Promise<bigint> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    return this.readBalance(this.account.address)
  }

  /** 重新领一次测试币；界面上的「再领一次」走这里。 */
  async claimFaucet(): Promise<FaucetResult> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    return this.requestFaucet(this.account.address)
  }

  /**
   * 导出助记词：**重新验证一次通行密钥**再现算，内存里不留一份长期副本。
   * 返回的字符串由调用方负责尽快丢弃，不得写进 localStorage 或日志。
   */
  async exportMnemonic(): Promise<string> {
    this.requireWebAuthn()
    // 必须是当前账户那一把：一个 rpId 下可以有多把，验错一把会导出成另一个钱包的助记词
    const known = this.activeCredential
    if (!known) throw new WalletError('locked', 'Wallet is locked')
    let prfOutput: Uint8Array | null = null
    try {
      const asserted = await getPasskeyPrfOutput({
        rpId: this.rpId,
        credential: { credentialId: known.credentialId, ...(known.transports ? { transports: known.transports } : {}) },
        ...(this.webAuthnClient ? { webAuthnClient: this.webAuthnClient } : {}),
      })
      prfOutput = asserted.prfOutput
      return mnemonicFromPrf(prfOutput)
    } catch (err) {
      throw toWalletError(err)
    } finally {
      prfOutput?.fill(0)
    }
  }

  private adopt(prfOutput: Uint8Array, credential: ActiveCredential): WalletAccount {
    this.logout()
    const derived = accountFromMnemonic(mnemonicFromPrf(prfOutput))
    this.session = derived.session
    this.signer = toViemAccount(derived.session)
    this.account = { address: derived.address, label: shortAddress(derived.address) }
    this.activeCredential = credential
    return this.account
  }

  private requireWebAuthn(): void {
    if (this.webAuthnClient) return
    if (typeof PublicKeyCredential === 'undefined') {
      throw new WalletError('unsupported', 'WebAuthn is unavailable in this browser')
    }
    // rpId 必须是一个域名：用 http://127.0.0.1 访问时浏览器会直接拒绝创建通行密钥，
    // 报错信息又只说「操作失败」，这里提前拦住，免得每次都去猜。
    if (isIpHost(this.rpId)) {
      throw new WalletError('insecure-host', `Passkeys need localhost or a domain, not ${this.rpId}`)
    }
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
      throw new WalletError('insecure-host', 'Passkeys need a secure context (https or localhost)')
    }
  }

  private async requestFaucet(address: EvmAddress): Promise<FaucetResult> {
    return claimFaucet(address, this.fetchImpl ? { fetchImpl: this.fetchImpl } : {})
  }

  private async readBalance(address: EvmAddress): Promise<bigint> {
    return this.client.getBalance({ address })
  }

  /** 水龙头是异步入账的，轮询到余额变化为止；超时就返回当前值，由界面提示稍后刷新。 */
  private async waitForFunding(address: EvmAddress, before: bigint): Promise<bigint> {
    const { tries, gapMs } = this.fundingPoll
    let latest = before
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, gapMs))
      latest = await this.readBalance(address).catch(() => latest)
      if (latest > before) return latest
    }
    return latest
  }
}

export const wallet = new MeraWallet()
