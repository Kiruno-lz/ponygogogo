/**
 * L2 契约测试：通行密钥钱包。跨越 mera（WebAuthn + 派生）、Alchemy（sma-b 账户与受赞助调用）、
 * viem（RPC）与水龙头 HTTP 四个外部契约，全部用注入的替身，断言的是**我们这一侧的协同**：
 * 注册与登录落在同一个根地址与同一个 sma-b、测试币与余额都在 sma-b 上、除 sma-b 公开地址外什么都不落盘、
 * 根账户余额能迁入 sma-b、领水与 sma-b 失败不影响注册成功、失败被分类成可判别的错误码。
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from 'viem'
import type { AccountClient } from '../../../src/chain/alchemy.ts'
import { FundsError } from '../../../src/chain/funds.ts'
import { MIGRATION_MIN_WEI } from '../../../src/chain/migration.ts'
import { MeraWallet, WalletError, type WalletDeps } from '../../../src/chain/wallet.ts'
import { CHAIN } from '../../../src/chain/network.ts'
import { vaultAbi } from '../../../src/chain/vault.ts'
import { accountFromMnemonic, mnemonicFromPrf } from '../../../src/chain/derive.ts'
import { FakeAuthenticator, type FakeAuthenticatorMode } from '../../fakes/authenticator.ts'

const RP_ID = 'ponygogogo.test'
const ONE_MON = 10n ** 18n
const GAS_PRICE = 100n * 10n ** 9n
const VAULT = '0x00000000000000000000000000000000000fa017' as Address
const POLICY = 'policy-l2'

/** 与 Alchemy 一样对同一个签名者给出同一个地址：取签名者地址哈希的低 20 字节 */
function smaFor(signer: Address): Address {
  return getAddress(`0x${keccak256(signer).slice(-40)}`)
}

/**
 * 记账用的假链：只答钱包真正需要的方法，其余一律报错，防止悄悄多打 RPC。
 * `eth_sendRawTransaction` 会校验签名、按交易内容真的扣减与入账，回执随之可查。
 */
function fakeChain() {
  const balances = new Map<string, bigint>()
  const available = new Map<string, bigint>()
  const code = new Map<string, Hex>()
  const receipts = new Map<string, 'success' | 'reverted'>()
  const calls: string[] = []
  const sentRaw: Array<{ from: Address; to: Address; value: bigint; gas: bigint; maxFeePerGas: bigint }> = []
  const nonces = new Map<string, number>()
  const key = (a: string) => a.toLowerCase()
  const hex = (v: bigint | number) => `0x${v.toString(16)}`
  const transport = custom({
    async request({ method, params }) {
      calls.push(method)
      const p = params as unknown[]
      switch (method) {
        case 'eth_chainId': return hex(CHAIN.id)
        case 'eth_blockNumber': return hex(1234)
        case 'eth_getBalance': return hex(balances.get(key(String(p[0]))) ?? 0n)
        case 'eth_getCode': return code.get(key(String(p[0]))) ?? '0x'
        case 'eth_call': {
          const req = p[0] as { to: string; data: Hex }
          if (key(req.to) !== key(VAULT)) throw new Error(`unexpected eth_call to ${req.to}`)
          const { args } = decodeFunctionData({ abi: vaultAbi, data: req.data }) as unknown as { args: readonly [Address] }
          return encodeAbiParameters([{ type: 'uint256' }], [available.get(key(args[0])) ?? 0n])
        }
        case 'eth_estimateGas': return hex(21_000)
        case 'eth_maxPriorityFeePerGas': return hex(2n * 10n ** 9n)
        case 'eth_getBlockByNumber': return {
          number: hex(1234), hash: `0x${'12'.repeat(32)}`, parentHash: `0x${'34'.repeat(32)}`, timestamp: hex(1_700_000_000),
          baseFeePerGas: hex(GAS_PRICE), gasLimit: hex(150_000_000), gasUsed: '0x0', transactions: [],
          logsBloom: `0x${'00'.repeat(256)}`, miner: '0x0000000000000000000000000000000000000000', difficulty: '0x0',
          extraData: '0x', nonce: '0x0000000000000000', sha3Uncles: `0x${'00'.repeat(32)}`, size: '0x0',
          stateRoot: `0x${'00'.repeat(32)}`, receiptsRoot: `0x${'00'.repeat(32)}`, transactionsRoot: `0x${'00'.repeat(32)}`,
          totalDifficulty: '0x0', uncles: [], mixHash: `0x${'00'.repeat(32)}`,
        }
        case 'eth_getTransactionCount': return hex(nonces.get(key(String(p[0]))) ?? 0)
        case 'eth_sendRawTransaction': {
          const raw = p[0] as TransactionSerialized
          const tx = parseTransaction(raw)
          const from = await recoverTransactionAddress({ serializedTransaction: raw })
          const fee = tx.gas! * GAS_PRICE
          const debit = tx.value! + tx.gas! * tx.maxFeePerGas!
          const hash = keccak256(raw)
          if ((balances.get(key(from)) ?? 0n) < debit) throw new Error('insufficient funds for gas * price + value')
          balances.set(key(from), (balances.get(key(from)) ?? 0n) - tx.value! - fee)
          balances.set(key(tx.to!), (balances.get(key(tx.to!)) ?? 0n) + tx.value!)
          nonces.set(key(from), (nonces.get(key(from)) ?? 0) + 1)
          sentRaw.push({ from, to: getAddress(tx.to!), value: tx.value!, gas: tx.gas!, maxFeePerGas: tx.maxFeePerGas! })
          receipts.set(hash, 'success')
          return hash
        }
        case 'eth_getTransactionReceipt': {
          const status = receipts.get(String(p[0]))
          if (!status) return null
          return {
            transactionHash: p[0], transactionIndex: '0x0', blockHash: `0x${'12'.repeat(32)}`, blockNumber: hex(1235),
            from: sentRaw.at(-1)!.from, to: sentRaw.at(-1)!.to, cumulativeGasUsed: hex(21_000), gasUsed: hex(21_000),
            effectiveGasPrice: hex(GAS_PRICE), contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`,
            status: status === 'success' ? '0x1' : '0x0', type: '0x2',
          }
        }
      }
      throw new Error(`unexpected rpc call: ${method}`)
    },
  })
  return {
    transport,
    calls,
    sentRaw,
    credit(address: string, amount: bigint) {
      balances.set(key(address), (balances.get(key(address)) ?? 0n) + amount)
    },
    balanceOf: (address: string) => balances.get(key(address)) ?? 0n,
    deployVault(avail: Record<string, bigint> = {}) {
      code.set(key(VAULT), '0x6080')
      for (const [k, v] of Object.entries(avail)) available.set(key(k), v)
    },
  }
}

/** 假 Alchemy：同一签名者给同一个 sma-b，记录发出的批量调用，状态可编排 */
function fakeAlchemy(behaviour: 'ok' | 'down' = 'ok') {
  const requests: unknown[] = []
  const sends: Array<{ account: Address; calls: unknown[]; capabilities: unknown }> = []
  let status: 'pending' | 'success' | 'failure' = 'success'
  const factory = (): AccountClient => ({
    requestAccount: async (args: { signerAddress: Address }) => {
      requests.push(args)
      if (behaviour === 'down') throw new Error('ALCHEMY_UNREACHABLE')
      return { type: 'json-rpc', address: smaFor(args.signerAddress) }
    },
    sendCalls: async (args: { account: Address; calls: unknown[]; capabilities: unknown }) => {
      sends.push(args)
      return { id: `call-${sends.length}` }
    },
    getCallsStatus: async () => ({
      status,
      receipts: status === 'pending' ? [] : [{ transactionHash: `0x${'cd'.repeat(32)}`, status: status === 'success' ? 'success' : 'reverted' }],
    }),
    grantPermissions: async () => ({ context: '0x' }),
  }) as unknown as AccountClient
  return { factory, requests, sends, setStatus: (s: typeof status) => { status = s } }
}

/** 假水龙头：记录收到的 body，并按需要给地址入账或拒绝 */
function fakeFaucet(chain: ReturnType<typeof fakeChain>, behaviour: 'grant' | 'reject' = 'grant') {
  const bodies: Array<{ chainId: number; address: string }> = []
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { chainId: number; address: string }
    bodies.push(body)
    if (behaviour === 'reject') return new Response('faucet dry', { status: 429 })
    chain.credit(body.address, ONE_MON)
    return new Response('queued', { status: 200 })
  }) as unknown as typeof fetch
  return { bodies, impl }
}

type Rig = {
  wallet: MeraWallet
  auth: FakeAuthenticator
  chain: ReturnType<typeof fakeChain>
  faucet: ReturnType<typeof fakeFaucet>
  alchemy: ReturnType<typeof fakeAlchemy>
}

function makeRig(
  opts: {
    mode?: FakeAuthenticatorMode
    faucet?: 'grant' | 'reject'
    alchemy?: 'ok' | 'down'
    vault?: Address | null
    share?: Partial<Rig>
  } = {},
): Rig {
  const auth = opts.share?.auth ?? new FakeAuthenticator(opts.mode ?? 'ok')
  const chain = opts.share?.chain ?? fakeChain()
  const faucet = fakeFaucet(chain, opts.faucet ?? 'grant')
  const alchemy = opts.share?.alchemy ?? fakeAlchemy(opts.alchemy ?? 'ok')
  const deps: WalletDeps = {
    rpId: RP_ID,
    webAuthnClient: auth.client,
    transport: chain.transport,
    fetchImpl: faucet.impl,
    fundingPoll: { tries: 5, gapMs: 0 },
    alchemyClient: alchemy.factory,
    alchemyPolicyId: POLICY,
    vaultAddress: opts.vault === undefined ? null : opts.vault,
    txPoll: { pollMs: 0, timeoutMs: 1000 },
  }
  return { wallet: new MeraWallet(deps), auth, chain, faucet, alchemy }
}

let rig: Rig
beforeEach(() => {
  rig = makeRig()
})

describe('通行密钥钱包契约', () => {
  test('未登录时没有账户，也没有签名器与游戏账户', () => {
    expect(rig.wallet.getAccount()).toBeNull()
    expect(rig.wallet.getSigner()).toBeNull()
    expect(rig.wallet.getGameAccount()).toBeNull()
    expect(rig.wallet.getCallAccount()).toBeNull()
  })

  test('注册：根 EOA 只做签名者，测试币领到独立 sma-b 上，余额来自 RPC', async () => {
    const seen: string[] = []
    const out = await rig.wallet.register({
      onAccount: (a) => seen.push(`root:${a.address}`),
      onGameAccount: (g) => seen.push(`game:${g.address}`),
    })
    expect(out.account.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(out.account.label).toBe(`${out.account.address.slice(0, 6)}…${out.account.address.slice(-4)}`)
    expect(out.game?.address).toBe(smaFor(out.account.address))
    expect(out.game?.address).not.toBe(out.account.address)
    expect(out.game?.label).toBe(`${out.game!.address.slice(0, 6)}…${out.game!.address.slice(-4)}`)
    expect(out.gameError).toBeNull()
    expect(seen).toEqual([`root:${out.account.address}`, `game:${out.game!.address}`])
    expect(rig.auth.size).toBe(1)
    expect(out.faucet?.ok).toBe(true)
    expect(rig.faucet.bodies).toEqual([{ chainId: CHAIN.id, address: out.game!.address }])
    expect(out.balance).toBe(ONE_MON)
    expect(out.funded).toBe(true)
    expect(rig.chain.balanceOf(out.account.address)).toBe(0n)
    expect(rig.chain.calls).toContain('eth_getBalance')
  })

  test('sma-b 以显式 createAdditional 向 Alchemy 申请，不复用根地址当账户', async () => {
    const out = await rig.wallet.register()
    expect(rig.alchemy.requests).toEqual([{
      signerAddress: out.account.address,
      creationHint: { accountType: 'sma-b', createAdditional: true },
    }])
    expect(rig.wallet.getGameAccount()).toEqual(out.game)
  })

  test('注册与导出全程只落盘 sma-b 的公开地址，密钥与名字一个字节都不写', async () => {
    // 密钥在认证器里、名字也在认证器里；浏览器这边只允许记下「这条链上这个根地址对应哪个 sma-b」
    const writes: string[] = []
    const g = globalThis as { localStorage?: unknown }
    const original = g.localStorage
    g.localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => void writes.push(`${k}=${v}`),
      removeItem: () => undefined,
    }
    let out: Awaited<ReturnType<MeraWallet['register']>>
    try {
      out = await rig.wallet.register({ userName: '小马仔' })
      await rig.wallet.exportMnemonic()
    } finally {
      g.localStorage = original
    }
    expect(writes).toEqual([`ponygogogo:sma-b:${CHAIN.id}:${out.account.address.toLowerCase()}=${out.game!.address}`])
  })

  test('用户名原样传给认证器；留空回落默认名，超长截断', async () => {
    await rig.wallet.register({ userName: '  小马仔  ' })
    expect(rig.auth.credentials[0]!.userName).toBe('小马仔')
    expect(rig.auth.credentials[0]!.displayName).toBe('小马仔')

    const blank = makeRig()
    await blank.wallet.register({ userName: '   ' })
    expect(blank.auth.credentials[0]!.userName).toBe('ponygogogo')

    const long = makeRig()
    await long.wallet.register({ userName: 'x'.repeat(80) })
    expect(long.auth.credentials[0]!.userName).toHaveLength(32)
  })

  test('再注册一次是新增一把密钥、一个新账户，不覆盖已有的', async () => {
    const first = await rig.wallet.register({ userName: '一号' })
    const second = await rig.wallet.register({ userName: '二号' })
    expect(second.account.address).not.toBe(first.account.address)
    expect(rig.auth.size).toBe(2)
    expect(rig.auth.credentials.map((c) => c.userName)).toEqual(['一号', '二号'])
  })

  test('登录不限定凭据，落在系统挑中的那一把的地址上', async () => {
    const first = await rig.wallet.register({ userName: '一号' })
    const second = await rig.wallet.register({ userName: '二号' })
    rig.wallet.logout()
    // preferred 模拟玩家在系统弹窗里挑了哪一把
    rig.auth.preferred = rig.auth.credentials[1]!.id
    expect((await rig.wallet.login()).address).toBe(second.account.address)
    rig.auth.preferred = rig.auth.credentials[0]!.id
    expect((await rig.wallet.login()).address).toBe(first.account.address)
  })

  test('本机记着多把时，导出的是当前账户那一把的助记词', async () => {
    await rig.wallet.register({ userName: '一号' })
    const second = await rig.wallet.register({ userName: '二号' })
    // 当前账户是二号。若断言没被限定到二号那一把，系统会挑第一把，导出就串号了
    rig.auth.preferred = rig.auth.credentials[0]!.id
    const words = await rig.wallet.exportMnemonic()
    expect(accountFromMnemonic(words).address).toBe(second.account.address)
  })

  test('注册 → 登出 → 登录，落在同一个根地址与同一个 sma-b', async () => {
    const created = await rig.wallet.register()
    rig.wallet.logout()
    expect(rig.wallet.getAccount()).toBeNull()
    expect(rig.wallet.getSigner()).toBeNull()
    expect(rig.wallet.getGameAccount()).toBeNull()
    // 认证器与本地凭据都还在，登录不需要再创建一把密钥
    const back = await rig.wallet.login()
    expect(back.address).toBe(created.account.address)
    // 登录本身不碰 Alchemy；sma-b 由界面随后单独解析
    expect(rig.wallet.getGameAccount()).toBeNull()
    expect(await rig.wallet.resolveGameAccount()).toEqual(created.game!)
    expect(rig.auth.size).toBe(1)
  })

  test('换一台设备（本地无凭据）也能用同一把通行密钥登录回同一个地址', async () => {
    const created = await rig.wallet.register()
    // 另一台设备上什么记录都没有，照样能用同一把通行密钥登录回同一个地址
    const other = makeRig({ share: { auth: rig.auth, chain: rig.chain } })
    const back = await other.wallet.login()
    expect(back.address).toBe(created.account.address)
  })

  test('用户在系统弹窗里选了另一把通行密钥，本地凭据跟着换，地址也跟着换', async () => {
    const first = await rig.wallet.register()
    rig.wallet.logout()
    // 第二把密钥：直接在同一个认证器上再注册一次
    const second = makeRig({ share: { auth: rig.auth, chain: rig.chain } })
    const secondAccount = await second.wallet.register()
    expect(rig.auth.size).toBe(2)
    expect(secondAccount.account.address).not.toBe(first.account.address)

    // 以平台实际返回的凭据为准：弹窗里挑了第二把，就该登录成第二个账户
    rig.auth.preferred = rig.auth.credentials[1]!.id
    expect((await rig.wallet.login()).address).toBe(secondAccount.account.address)
    // 随后导出的也必须是这个账户的助记词，而不是第一把的
    rig.auth.preferred = rig.auth.credentials[0]!.id
    expect(accountFromMnemonic(await rig.wallet.exportMnemonic()).address).toBe(
      secondAccount.account.address,
    )
  })

  test('登出会结束签名会话；签名器不再可用', async () => {
    await rig.wallet.register()
    const signer = rig.wallet.getSigner()
    expect(signer).not.toBeNull()
    rig.wallet.logout()
    await expect(signer!.signMessage({ message: 'hi' })).rejects.toThrow()
  })

  test('导出助记词：24 词，且确实对应当前地址', async () => {
    const out = await rig.wallet.register()
    const words = await rig.wallet.exportMnemonic()
    expect(words.split(' ')).toHaveLength(24)
    expect(accountFromMnemonic(words).address).toBe(out.account.address)
  })

  test('图鉴使用独立 PRF 命名空间，跨设备恢复但不改变根钱包', async () => {
    const registered = await rig.wallet.register()
    const walletMnemonic = await rig.wallet.exportMnemonic()
    const collectionKey = await rig.wallet.deriveCollectionKey()
    expect(collectionKey).toHaveLength(32)
    expect(mnemonicFromPrf(collectionKey)).not.toBe(walletMnemonic)
    const other = makeRig({ share: { auth: rig.auth, chain: rig.chain } })
    expect((await other.wallet.login()).address).toBe(registered.account.address)
    const recovered = await other.wallet.deriveCollectionKey()
    expect(recovered).toEqual(collectionKey)
    expect(other.wallet.getAccount()?.address).toBe(registered.account.address)
    collectionKey.fill(0)
    recovered.fill(0)
    rig.wallet.logout()
    await expect(rig.wallet.deriveCollectionKey()).rejects.toMatchObject({ code: 'locked' })
  })

  test('图鉴 PRF 断言若返回另一把凭据则拒绝密钥与同步身份', async () => {
    await rig.wallet.register({ userName: '一号' })
    await rig.wallet.register({ userName: '二号' })
    rig.auth.returnedCredentialId = rig.auth.credentials[0]!.id
    await expect(rig.wallet.deriveCollectionKey()).rejects.toThrow('CREDENTIAL_MISMATCH')
    await expect(rig.wallet.openCollectionIdentity()).rejects.toThrow('CREDENTIAL_MISMATCH')
  })

  test('图鉴签名身份与钱包分离，跨设备一致且退出即失效', async () => {
    await rig.wallet.register()
    const identity = await rig.wallet.openCollectionIdentity()
    const message = new TextEncoder().encode('collection sync challenge')
    const signature = await identity.signMessage(message)
    const other = makeRig({ share: { auth: rig.auth, chain: rig.chain } })
    await other.wallet.login()
    const recovered = await other.wallet.openCollectionIdentity()
    expect(recovered.publicKey).toEqual(identity.publicKey)
    expect(await recovered.signMessage(message)).toEqual(signature)
    rig.wallet.logout()
    await expect(identity.signMessage(message)).rejects.toThrow()
    other.wallet.logout()
  })

  test('未登录时不允许导出助记词——不知道该验证哪一把', async () => {
    const before = await rig.wallet.exportMnemonic().catch((e: unknown) => e)
    expect((before as WalletError).code).toBe('locked')
    // 登出之后同样不行：当前凭据随会话一起清掉了
    await rig.wallet.register()
    rig.wallet.logout()
    const after = await rig.wallet.exportMnemonic().catch((e: unknown) => e)
    expect(after).toBeInstanceOf(WalletError)
    expect((after as WalletError).code).toBe('locked')
  })

  test('领水失败不影响注册成功，余额如实为零', async () => {
    const dry = makeRig({ faucet: 'reject' })
    const out = await dry.wallet.register()
    expect(out.account.address).toMatch(/^0x/)
    expect(out.faucet?.ok).toBe(false)
    expect(out.faucet?.ok === false && out.faucet.code).toBe('rejected')
    expect(out.balance).toBe(0n)
    expect(out.funded).toBe(false)
    expect(dry.wallet.getAccount()).not.toBeNull()
  })

  test('水龙头受理了但迟迟不入账时，funded 为假——受理不等于到账', async () => {
    // 水龙头答 200 却不给地址记账：轮询跑满后余额仍是 0
    const chain = fakeChain()
    const auth = new FakeAuthenticator('ok')
    const bodies: Array<unknown> = []
    const lazyFaucet = (async (_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('queued', { status: 200 })
    }) as unknown as typeof fetch
    const w = new MeraWallet({
      rpId: RP_ID,
      webAuthnClient: auth.client,
      transport: chain.transport,
      fetchImpl: lazyFaucet,
      fundingPoll: { tries: 3, gapMs: 0 },
      alchemyClient: fakeAlchemy().factory,
      vaultAddress: null,
    })
    const out = await w.register()
    expect(out.faucet?.ok).toBe(true)
    expect(out.funded).toBe(false)
    expect(out.balance).toBe(0n)
    expect(bodies).toHaveLength(1)
  })

  test('注册后再领一次测试币仍发给 sma-b，余额刷新读的是 sma-b', async () => {
    const out = await rig.wallet.register()
    const again = await rig.wallet.claimFaucet()
    expect(again.ok).toBe(true)
    expect(rig.faucet.bodies.map((b) => b.address)).toEqual([out.game!.address, out.game!.address])
    expect(await rig.wallet.refreshBalance()).toBe(2n * ONE_MON)
    expect(await rig.wallet.readRootBalance()).toBe(0n)
    expect(out.balance).toBe(ONE_MON)
  })

  test('未登录时读余额、读资金、领水、迁移都报 locked，而不是打空请求', async () => {
    for (const call of [
      () => rig.wallet.refreshBalance(),
      () => rig.wallet.readRootBalance(),
      () => rig.wallet.readFunds(),
      () => rig.wallet.claimFaucet(),
      () => rig.wallet.migrateRootFunds(),
      () => rig.wallet.resolveGameAccount(),
    ]) {
      const err = await call().catch((e: unknown) => e)
      expect((err as WalletError).code).toBe('locked')
    }
    expect(rig.faucet.bodies).toHaveLength(0)
    expect(rig.alchemy.requests).toHaveLength(0)
  })

  test('Alchemy 不可用：注册仍成功，不领水（绝不回落到根地址），错误码为 game-account', async () => {
    const down = makeRig({ alchemy: 'down' })
    const out = await down.wallet.register()
    expect(down.wallet.getAccount()?.address).toBe(out.account.address)
    expect(out.game).toBeNull()
    expect(out.gameError?.code).toBe('game-account')
    expect(out.faucet).toBeNull()
    expect(out.balance).toBeNull()
    expect(down.faucet.bodies).toHaveLength(0)
    await expect(down.wallet.claimFaucet()).rejects.toMatchObject({ code: 'game-account' })
    expect(down.faucet.bodies).toHaveLength(0)
  })

  test('没配置 Alchemy API key 时 sma-b 解析报 game-account，而不是未分类的异常', async () => {
    const chain = fakeChain()
    const auth = new FakeAuthenticator('ok')
    const w = new MeraWallet({ rpId: RP_ID, webAuthnClient: auth.client, transport: chain.transport,
      fetchImpl: fakeFaucet(chain).impl, fundingPoll: { tries: 1, gapMs: 0 }, alchemyApiKey: '', vaultAddress: null })
    const out = await w.register()
    expect(out.gameError?.code).toBe('game-account')
    expect(out.gameError?.message).toBe('ALCHEMY_API_KEY_REQUIRED')
  })

  test('资金快照：Vault 未配置或没有代码时报 not-deployed，钱包余额照常来自同一块', async () => {
    const out = await rig.wallet.register()
    expect(await rig.wallet.readFunds()).toEqual({
      blockNumber: 1234n, player: out.game!.address, wallet: ONE_MON, vault: { state: 'not-deployed', reason: 'unset' },
    })
    const noCode = makeRig({ vault: VAULT, share: { auth: rig.auth, chain: rig.chain } })
    await noCode.wallet.login()
    expect((await noCode.wallet.readFunds()).vault).toEqual({ state: 'not-deployed', reason: 'no-code' })
    const err = await noCode.wallet.deposit(await noCode.wallet.readFunds(), 1n).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FundsError)
    expect((err as FundsError).code).toBe('vault-not-deployed')
    expect(noCode.alchemy.sends).toHaveLength(0)
  })

  test('充值与提款由 sma-b 发出受赞助的 Vault 调用，调用 ID 追到入块', async () => {
    const w = makeRig({ vault: VAULT })
    const out = await w.wallet.register()
    w.chain.deployVault({ [out.game!.address]: 3n * ONE_MON / 10n })
    const funds = await w.wallet.readFunds()
    expect(funds.vault).toEqual({ state: 'ready', address: VAULT, available: 3n * ONE_MON / 10n })

    const depositId = await w.wallet.deposit(funds, ONE_MON / 2n)
    const withdrawId = await w.wallet.withdraw(funds, ONE_MON / 10n)
    expect([depositId, withdrawId]).toEqual(['call-1', 'call-2'])
    const [dep, wd] = w.alchemy.sends
    expect(dep!.account).toBe(out.game!.address)
    expect(dep!.capabilities).toEqual({ paymaster: { policyId: POLICY } })
    const depCall = dep!.calls[0] as { to: Address; data: Hex; value: bigint }
    expect(depCall.to).toBe(VAULT)
    expect(depCall.value).toBe(ONE_MON / 2n)
    expect(decodeFunctionData({ abi: vaultAbi, data: depCall.data }).functionName).toBe('deposit')
    const wdCall = wd!.calls[0] as { to: Address; data: Hex }
    expect(decodeFunctionData({ abi: vaultAbi, data: wdCall.data })).toEqual({ functionName: 'withdraw', args: [ONE_MON / 10n] })

    const progress: string[] = []
    expect(await w.wallet.trackCall(depositId, (p) => progress.push(p.state)))
      .toEqual({ state: 'included', callId: 'call-1', transactionHashes: [`0x${'cd'.repeat(32)}`] })
    expect(progress).toEqual(['included'])
    w.alchemy.setStatus('failure')
    expect((await w.wallet.trackCall(withdrawId)).state).toBe('failed')
    w.alchemy.setStatus('pending')
    expect(await w.wallet.trackCall(withdrawId)).toEqual({ state: 'timeout', callId: withdrawId })

    // 本地先拦下注定失败的金额，不发交易
    await expect(w.wallet.deposit(funds, 2n * ONE_MON)).rejects.toMatchObject({ code: 'insufficient-wallet' })
    await expect(w.wallet.withdraw(funds, ONE_MON)).rejects.toMatchObject({ code: 'insufficient-available' })
    expect(w.alchemy.sends).toHaveLength(2)
  })

  test('根账户余额迁入 sma-b：根地址自付 Gas，转出余额减去 gas 上限 × maxFee', async () => {
    const out = await rig.wallet.register()
    rig.chain.credit(out.account.address, 2n * ONE_MON)
    const res = await rig.wallet.migrateRootFunds()
    const maxFee = GAS_PRICE * 12n / 10n + 2n * 10n ** 9n // viem：baseFee × 1.2 + priority
    expect(res.state).toBe('submitted')
    if (res.state !== 'submitted') return
    expect(res.amount).toBe(2n * ONE_MON - 21_000n * maxFee)
    expect(rig.chain.sentRaw).toEqual([{ from: out.account.address, to: out.game!.address, value: res.amount, gas: 21_000n, maxFeePerGas: maxFee }])
    // Monad 支持 eth_fillTransaction 且会填回更高的费率；钱包必须不给它覆盖的机会
    expect(rig.chain.calls).not.toContain('eth_fillTransaction')
    expect(await rig.wallet.trackTransaction(res.hash)).toEqual({ state: 'success', hash: res.hash })
    expect(rig.chain.balanceOf(out.game!.address)).toBe(ONE_MON + res.amount)
    // 实际只扣 gas × 实付单价，差额零头留在根地址
    expect(rig.chain.balanceOf(out.account.address)).toBe(21_000n * (maxFee - GAS_PRICE))
  })

  test('根账户余额不值得迁移时跳过，不签名也不发交易', async () => {
    const out = await rig.wallet.register()
    rig.chain.credit(out.account.address, MIGRATION_MIN_WEI - 1n)
    expect(await rig.wallet.migrateRootFunds()).toEqual({ state: 'skipped', reason: 'too-small', balance: MIGRATION_MIN_WEI - 1n })
    // 扣掉手续费上限后恰好差 1 wei 才够门槛：仍然跳过
    rig.chain.credit(out.account.address, 21_000n * (GAS_PRICE * 12n / 10n + 2n * 10n ** 9n))
    expect((await rig.wallet.migrateRootFunds()).state).toBe('skipped')
    expect(rig.chain.sentRaw).toHaveLength(0)
    expect(rig.chain.calls).not.toContain('eth_sendRawTransaction')
  })

  test('用户取消通行密钥弹窗 → cancelled', async () => {
    const cancelled = makeRig({ mode: 'cancel' })
    for (const call of [() => cancelled.wallet.register(), () => cancelled.wallet.login()]) {
      const err = await call().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(WalletError)
      expect((err as WalletError).code).toBe('cancelled')
    }
  })

  test('认证器不支持 PRF 扩展 → no-prf，注册不留下半个账户', async () => {
    const noPrf = makeRig({ mode: 'no-prf' })
    const err = await noPrf.wallet.register().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WalletError)
    expect((err as WalletError).code).toBe('no-prf')
    expect(noPrf.wallet.getAccount()).toBeNull()
  })

  test('助记词由 PRF 输出唯一决定，与注册那次的返回值无关', async () => {
    const out = await rig.wallet.register()
    const words = await rig.wallet.exportMnemonic()
    const prf = await crypto.subtle.digest(
      'SHA-256',
      new Uint8Array([
        ...rig.auth.credentials[0]!.secret,
        ...new TextEncoder().encode(RP_ID),
        ...(await sha256(new TextEncoder().encode('mera.prf.salt.v1'))),
      ]),
    )
    expect(mnemonicFromPrf(new Uint8Array(prf))).toBe(words)
    expect(accountFromMnemonic(words).address).toBe(out.account.address)
  })
})

/** mera 的默认 PRF salt 是 sha256("mera.prf.salt.v1")，上面那条测试要自己算一遍 */
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}
