/**
 * 通行密钥钱包。项目里唯一持有账户身份的地方。
 *
 * **两个地址，两种角色**：通行密钥 PRF 派生出根 EOA，它只做签名者与 owner；玩家的游戏账户是由根
 * EOA 拥有的独立 Alchemy Modular Account V2（sma-b）。测试币、钱包余额、比赛下注与奖金都落在 sma-b 上。
 *
 * 注册：创建一把 rpId 下的通行密钥（名字由玩家自己起）→ 取 PRF 输出 → 派生根 EOA → 解析 sma-b → 给 sma-b 领测试币。
 * 登录：唤起某一把通行密钥的断言 → 同一个 PRF 输出 → 同一个根地址 → 同一个 sma-b。
 * 登出：结束签名会话把私钥清零，账户从内存里移除。
 * 迁入：早期版本把测试币领到了根 EOA，`migrateRootFunds` 用根 EOA 自付 Gas 把余额转进 sma-b。
 *
 * **一个 rpId 下可以有多把通行密钥，每把对应一个独立账户。** 登录不限定凭据，由系统自己
 * 列出全部让玩家挑；哪一把派生出了当前账户只记在内存里，导出助记词必须重新验证同一把，
 * 验错了会导出成另一个钱包。
 *
 * Mera 根密钥、助记词和签名会话不落盘；刷新页面即回到未登录。
 * 独立 Alchemy 智能账户只有公开地址按链与根地址保存在浏览器，用于恢复时核对。
 */
import {
  createEd25519SigningSession,
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
  type EvmAddress,
  type Ed25519SigningSession,
  type PasskeyCredentialTransport,
  type Secp256k1SigningSession,
  type WebAuthnClient,
} from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import {
  createPublicClient,
  createWalletClient,
  hexToBytes,
  http,
  sha256,
  toBytes,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
} from 'viem'
import { accountFromMnemonic, mnemonicFromPrf, shortAddress } from './derive.ts'
import { AlchemyAccount, createAlchemyAccount, type AccountClient, type CallAccount } from './alchemy.ts'
import { DEV_CHAIN, DirectEoaAccount, devFaucet, type DevChain } from './devChain.ts'
import { claimFaucet, type FaucetResult } from './faucet.ts'
import {
  readFunds,
  trackCall,
  trackTransaction,
  type FundsSnapshot,
  type ReceiptResult,
  type TrackOptions,
  type TrackResult,
} from './funds.ts'
import { MIGRATION_MIN_WEI, planMigration } from './migration.ts'
import { CHAIN, DEFAULT_PASSKEY_NAME, RPC_URL, RP_NAME, defaultRpId } from './network.ts'

/** 名字只是认证器列表里的标签，别让它长到撑爆系统弹窗 */
const MAX_NAME_LEN = 32
const COLLECTION_PRF_SALT = hexToBytes(sha256(toBytes('ponygogogo/collection/encryption/v1')))
const COLLECTION_IDENTITY_SALT = hexToBytes(sha256(toBytes('ponygogogo/collection/identity/v1')))

/** 根 EOA：签名者与 sma-b 的 owner，不持有游戏资金。 */
export type WalletAccount = {
  readonly address: EvmAddress
  /** 地址摘要，界面短展示用 */
  readonly label: string
}

/** 玩家的游戏账户：独立 sma-b。测试币、钱包余额与 Vault 资金都记在这个地址上。 */
export type GameAccount = {
  readonly address: Address
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
  /** 派生出根地址的那一刻回调一次，让界面先画出来，别等领水 */
  onAccount?: (account: WalletAccount) => void
  /** sma-b 解析出来的那一刻回调一次 */
  onGameAccount?: (account: GameAccount) => void
}

export type RegisterOutcome = {
  readonly account: WalletAccount
  /** sma-b；Alchemy 不可用时为 null，注册本身仍然成功（通行密钥已经建好） */
  readonly game: GameAccount | null
  readonly gameError: WalletError | null
  /** 没有 sma-b 就不领水：测试币只发给游戏账户，绝不回落到根地址 */
  readonly faucet: FaucetResult | null
  /** 领水后（或超时后）读到的 sma-b 余额；没有 sma-b 时为 null */
  readonly balance: bigint | null
  /**
   * 余额是否真的涨了。水龙头收下请求（`faucet.ok`）只说明它受理了，不等于已经入账；
   * 界面要据此区分「已到账」和「已提交，稍后刷新」，不能拿受理当到账。
   */
  readonly funded: boolean
}

export type MigrationOutcome =
  | { readonly state: 'submitted'; readonly hash: Hex; readonly amount: bigint }
  | { readonly state: 'skipped'; readonly reason: 'too-small'; readonly balance: bigint }

/** 界面要按类别给出不同的引导，所以错误必须是可判别的码，不是一句话。 */
export type WalletErrorCode =
  | 'unsupported' // 环境没有 WebAuthn
  | 'insecure-host' // 用 IP 或非安全上下文访问：WebAuthn 的 rpId 只接受 localhost 或真实域名
  | 'cancelled' // 用户取消或认证器不可用
  | 'no-prf' // 认证器不支持 PRF 扩展
  | 'no-crypto' // 运行时缺 Web Crypto
  | 'locked' // 未登录就调用了需要会话的操作
  | 'game-account' // 独立智能账户（sma-b）解析失败：Alchemy 不可达、未配置或返回了不一致的地址
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
  alchemyApiKey?: string
  alchemyPolicyId?: string
  /** 注入的 Alchemy 钱包客户端工厂；不传就按 API key 连真实服务 */
  alchemyClient?: (signer: LocalAccount) => AccountClient
  /** Vault 地址；不传就用构建期配置，null 表示未部署 */
  /** 交易状态轮询节奏；测试注入 0 间隔 */
  txPoll?: Pick<TrackOptions, 'pollMs' | 'timeoutMs'>
  /**
   * 本地开发链：游戏账户换成根 EOA 自己（直接发交易），领水换成 anvil_setBalance。
   * 缺省取构建期 DEV_CHAIN（仅 dev 构建 + VITE_DEV_CHAIN=anvil），生产构建恒为 null。
   */
  devChain?: DevChain | null
}

/** 游戏账户：发交易的 CallAccount，外加一次性的地址解析。 */
type GameCallAccount = CallAccount & { resolve(): Promise<Address> }

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
  private readonly transport: Transport
  private readonly client: PublicClient
  private readonly fundingPoll: { tries: number; gapMs: number }
  private readonly alchemyApiKey: string
  private readonly alchemyPolicyId: string
  private readonly alchemyClient: ((signer: LocalAccount) => AccountClient) | undefined
  private readonly txPoll: Pick<TrackOptions, 'pollMs' | 'timeoutMs'>
  private readonly devChain: DevChain | null

  private session: Secp256k1SigningSession | null = null
  private signer: LocalAccount<'mera'> | null = null
  private account: WalletAccount | null = null
  /** 当前账户由哪一把通行密钥派生；导出助记词必须验证同一把 */
  private activeCredential: ActiveCredential | null = null
  private gameAccount: GameCallAccount | null = null
  private gameAccountPending: Promise<GameCallAccount> | null = null
  private collectionIdentity: Ed25519SigningSession | null = null
  private collectionIdentityPending: Promise<Ed25519SigningSession> | null = null

  constructor(deps: WalletDeps = {}) {
    this.rpId = deps.rpId ?? defaultRpId()
    this.webAuthnClient = deps.webAuthnClient
    this.fetchImpl = deps.fetchImpl
    this.transport = deps.transport ?? http(RPC_URL)
    this.client = createPublicClient({ chain: CHAIN, transport: this.transport })
    this.fundingPoll = deps.fundingPoll ?? { tries: 15, gapMs: 1000 }
    this.alchemyApiKey = deps.alchemyApiKey ?? (import.meta.env?.VITE_ALCHEMY_API_KEY as string | undefined) ?? ''
    this.alchemyPolicyId = deps.alchemyPolicyId ?? (import.meta.env?.VITE_ALCHEMY_POLICY_ID as string | undefined) ?? ''
    this.alchemyClient = deps.alchemyClient
    this.txPoll = deps.txPoll ?? {}
    this.devChain = deps.devChain !== undefined ? deps.devChain : DEV_CHAIN
  }

  /** 与钱包共用 transport 的只读客户端：有奖会话的读取与链上时钟都用它。 */
  get publicClient(): PublicClient {
    return this.client
  }

  /** 是否跑在本地开发链上（游戏账户即根 EOA） */
  get onDevChain(): boolean {
    return this.devChain !== null
  }

  /** 已登录的账户；未登录为 null。刷新页面即回到未登录。 */
  getAccount(): WalletAccount | null {
    return this.account
  }

  /** 根 EOA 签名器：sma-b 的 owner；未登录时为 null。 */
  getSigner(): LocalAccount<'mera'> | null {
    return this.signer
  }

  /** 已解析的 sma-b；未登录或尚未解析时为 null。 */
  getGameAccount(): GameAccount | null {
    const address = this.gameAccount?.getAddress()
    return address ? { address, label: shortAddress(address) } : null
  }

  /** 发交易用的 sma-b；未解析时为 null。 */
  getCallAccount(): CallAccount | null {
    return this.gameAccount?.getAddress() ? this.gameAccount : null
  }

  /** 解析 sma-b 并按可判别的错误码报告失败。同一根地址并发调用只打一次 Alchemy。 */
  async resolveGameAccount(): Promise<GameAccount> {
    try {
      const account = await this.connectGameAccount()
      const address = account.getAddress()
      if (!address) throw new Error('ALCHEMY_ACCOUNT_NOT_RESOLVED')
      return { address, label: shortAddress(address) }
    } catch (err) {
      if (err instanceof WalletError) throw err
      throw new WalletError('game-account', err instanceof Error ? err.message : String(err), { cause: err })
    }
  }

  /** Resolve a separate sma-b from the currently unlocked Mera root. */
  async connectGameAccount(): Promise<GameCallAccount> {
    const signer = this.signer
    const session = this.session
    if (!signer || !session) throw new WalletError('locked', 'Wallet is locked')
    if (this.gameAccount) return this.gameAccount
    if (this.gameAccountPending) return this.gameAccountPending
    const pending = (async () => {
      const account: GameCallAccount = this.devChain
        ? new DirectEoaAccount(signer, this.client, this.transport)
        : this.alchemyClient
          ? new AlchemyAccount(this.alchemyClient(signer), signer.address, this.alchemyPolicyId)
          : createAlchemyAccount(signer, this.alchemyApiKey, this.alchemyPolicyId)
      await account.resolve()
      // The passkey may have been replaced or logged out while Alchemy replied.
      if (this.session !== session) throw new WalletError('locked', 'Wallet changed during account resolution')
      this.gameAccount = account
      return account
    })()
    this.gameAccountPending = pending
    try {
      return await pending
    } finally {
      if (this.gameAccountPending === pending) this.gameAccountPending = null
    }
  }

  /**
   * 注册：创建通行密钥 → 派生根 EOA → 解析 sma-b → 给 sma-b 领测试币 → 读余额。
   * sma-b 解析失败或领水失败都不影响注册成功：通行密钥已经建好，玩家随时能登录回来。
   *
   * 领水要等链上入账，最坏十几秒。`onAccount` 在派生出地址的那一刻就回调一次，
   * 让界面先把钱包画出来，余额随后落位——否则注册按钮会停在「创建中」看起来像卡死。
   */
  async register({ userName, onAccount, onGameAccount }: RegisterOptions = {}): Promise<RegisterOutcome> {
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
      prfOutput.fill(0)
      prfOutput = null
      let game: GameAccount
      try {
        game = await this.resolveGameAccount()
      } catch (err) {
        return { account, game: null, gameError: toWalletError(err), faucet: null, balance: null, funded: false }
      }
      onGameAccount?.(game)
      const before = await this.readBalance(game.address).catch(() => 0n)
      // 按地址领，不读 this.account：轮询期间玩家可能已经退出，那时注册流程仍要走完
      const faucet = await this.requestFaucet(game.address)
      const balance = faucet.ok ? await this.waitForFunding(game.address, before) : before
      return { account, game, gameError: null, faucet, balance, funded: balance > before }
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
    this.collectionIdentity?.end()
    this.session = null
    this.signer = null
    this.account = null
    this.activeCredential = null
    this.gameAccount = null
    this.gameAccountPending = null
    this.collectionIdentity = null
    this.collectionIdentityPending = null
  }

  /** sma-b 的原生 MON 余额。 */
  async refreshBalance(): Promise<bigint> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    const game = await this.resolveGameAccount()
    return this.readBalance(game.address)
  }

  /** 根 EOA 的原生余额：只用来决定要不要露出「迁入游戏账户」。 */
  async readRootBalance(): Promise<bigint> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    // 开发链上根 EOA 就是游戏账户，没有东西可迁
    if (this.devChain) return 0n
    return this.readBalance(this.account.address)
  }

  /** 指定块高度的 sma-b 原生 MON 余额。 */
  async readFunds(): Promise<FundsSnapshot> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    const game = await this.resolveGameAccount()
    return readFunds(this.client, game.address)
  }

  async trackCall(callId: string, onProgress?: TrackOptions['onProgress']): Promise<TrackResult> {
    return trackCall(await this.callAccount(), callId, { ...this.txPoll, ...(onProgress ? { onProgress } : {}) })
  }

  async trackTransaction(hash: Hex): Promise<ReceiptResult> {
    return trackTransaction(this.client, hash, this.txPoll)
  }

  /** 重新领一次测试币，发给 sma-b；界面上的「再领一次」走这里。 */
  async claimFaucet(): Promise<FaucetResult> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    const game = await this.resolveGameAccount()
    return this.requestFaucet(game.address)
  }

  /**
   * 把根 EOA 的原生余额（扣掉手续费上限）转进 sma-b。普通 EOA 交易，由 Mera 签名器签名、
   * 经公共 RPC 发出，根地址自付 Gas；扣完手续费不足 `MIGRATION_MIN_WEI` 就跳过。
   * 返回交易哈希，入块与否由 `trackTransaction` 追。
   */
  async migrateRootFunds(): Promise<MigrationOutcome> {
    const signer = this.signer
    const session = this.session
    if (!signer || !session) throw new WalletError('locked', 'Wallet is locked')
    // 每对读互不依赖，并行发出；按原先的先后取结果，都失败时报的仍是逐个读时的那一个
    const settled = <T>(r: PromiseSettledResult<T>): T => {
      if (r.status === 'rejected') throw r.reason
      return r.value
    }
    const [gameRead, balanceRead] = await Promise.allSettled([
      this.resolveGameAccount(),
      this.client.getBalance({ address: signer.address }),
    ])
    const game = settled(gameRead)
    const balance = settled(balanceRead)
    if (balance < MIGRATION_MIN_WEI) return { state: 'skipped', reason: 'too-small', balance }
    const [gasRead, feesRead] = await Promise.allSettled([
      // 金额不影响转账的 gas，按 1 wei 估，免得估算本身因「余额不够付 value」而失败
      this.client.estimateGas({ account: signer.address, to: game.address, value: 1n }),
      this.client.estimateFeesPerGas(),
    ])
    const gas = settled(gasRead)
    const fees = settled(feesRead)
    const plan = planMigration(balance, gas, fees.maxFeePerGas)
    if (!plan.ok) return { state: 'skipped', reason: 'too-small', balance }
    // 估算期间玩家可能已经退出或换了账户：签名器已经失效，别拿旧会话发交易
    if (this.session !== session) throw new WalletError('locked', 'Wallet changed during migration')
    try {
      // nonce 与 chainId 显式给出：viem 否则会先试 eth_fillTransaction，节点填回的 gas/费率会覆盖
      // 上面按余额算好的数，value + 手续费上限就可能超过余额
      const nonce = await this.client.getTransactionCount({ address: signer.address, blockTag: 'pending' })
      const hash = await createWalletClient({ account: signer, chain: CHAIN, transport: this.transport }).sendTransaction({
        to: game.address,
        value: plan.amount,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        nonce,
        chainId: CHAIN.id,
        type: 'eip1559',
      })
      return { state: 'submitted', hash, amount: plan.amount }
    } catch (err) {
      throw toWalletError(err)
    }
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
      if (asserted.credentialId !== known.credentialId) throw new Error('CREDENTIAL_MISMATCH')
      return mnemonicFromPrf(prfOutput)
    } catch (err) {
      throw toWalletError(err)
    } finally {
      prfOutput?.fill(0)
    }
  }

  /** A separate passkey PRF output for encrypted collection data. Caller must zero it after use. */
  async deriveCollectionKey(): Promise<Uint8Array> {
    this.requireWebAuthn()
    const known = this.activeCredential
    const session = this.session
    if (!known || !session) throw new WalletError('locked', 'Wallet is locked')
    let key: Uint8Array | null = null
    try {
      const asserted = await getPasskeyPrfOutput({
        rpId: this.rpId,
        credential: { credentialId: known.credentialId, ...(known.transports ? { transports: known.transports } : {}) },
        prfSalt: COLLECTION_PRF_SALT,
        ...(this.webAuthnClient ? { webAuthnClient: this.webAuthnClient } : {}),
      })
      key = asserted.prfOutput
      if (asserted.credentialId !== known.credentialId) throw new Error('CREDENTIAL_MISMATCH')
      if (this.session !== session) throw new WalletError('locked', 'Wallet changed during collection key derivation')
      return key
    } catch (err) {
      key?.fill(0)
      throw toWalletError(err)
    }
  }

  /** Ed25519 identity for collection sync challenges; never signs EVM transactions. */
  async openCollectionIdentity(): Promise<Ed25519SigningSession> {
    this.requireWebAuthn()
    const known = this.activeCredential
    const session = this.session
    if (!known || !session) throw new WalletError('locked', 'Wallet is locked')
    if (this.collectionIdentity) return this.collectionIdentity
    if (this.collectionIdentityPending) return this.collectionIdentityPending
    const pending = (async () => {
      let key: Uint8Array | null = null
      try {
        const asserted = await getPasskeyPrfOutput({
          rpId: this.rpId,
          credential: { credentialId: known.credentialId, ...(known.transports ? { transports: known.transports } : {}) },
          prfSalt: COLLECTION_IDENTITY_SALT,
          ...(this.webAuthnClient ? { webAuthnClient: this.webAuthnClient } : {}),
        })
        key = asserted.prfOutput
        if (asserted.credentialId !== known.credentialId) throw new Error('CREDENTIAL_MISMATCH')
        if (this.session !== session) throw new WalletError('locked', 'Wallet changed during collection identity derivation')
        const identity = createEd25519SigningSession({ privateKey: key })
        this.collectionIdentity = identity
        return identity
      } catch (err) {
        throw toWalletError(err)
      } finally {
        key?.fill(0)
      }
    })()
    this.collectionIdentityPending = pending
    try {
      return await pending
    } finally {
      if (this.collectionIdentityPending === pending) this.collectionIdentityPending = null
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

  private async callAccount(): Promise<CallAccount> {
    if (!this.account) throw new WalletError('locked', 'Wallet is locked')
    await this.resolveGameAccount()
    const account = this.getCallAccount()
    if (!account) throw new WalletError('game-account', 'ALCHEMY_ACCOUNT_NOT_RESOLVED')
    return account
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
    if (this.devChain) {
      try {
        const balance = await devFaucet(this.client, address)
        return { ok: true, detail: `anvil_setBalance ${balance}` }
      } catch (err) {
        return { ok: false, code: 'network', detail: err instanceof Error ? err.message : String(err) }
      }
    }
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
