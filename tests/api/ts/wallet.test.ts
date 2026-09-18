/**
 * L2 契约测试：通行密钥钱包。跨越 mera（WebAuthn + 派生）、viem（RPC）与水龙头 HTTP 三个外部契约，
 * 三者都用注入的替身，断言的是**我们这一侧的协同**：注册与登录落在同一个地址、
 * 什么都不落盘、余额来自 RPC、领水失败不影响注册成功、失败被分类成可判别的错误码。
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { custom } from 'viem'
import { MeraWallet, WalletError, type WalletDeps } from '../../../src/chain/wallet.ts'
import { CHAIN } from '../../../src/chain/network.ts'
import { accountFromMnemonic, mnemonicFromPrf } from '../../../src/chain/derive.ts'
import { FakeAuthenticator, type FakeAuthenticatorMode } from '../../fakes/authenticator.ts'

const RP_ID = 'ponygogogo.test'
const ONE_MON = 10n ** 18n

/** 记账用的假链：只答 eth_getBalance 与 eth_chainId，其余方法一律报错，防止悄悄多打 RPC */
function fakeChain() {
  const balances = new Map<string, bigint>()
  const calls: string[] = []
  const transport = custom({
    async request({ method, params }) {
      calls.push(method)
      if (method === 'eth_chainId') return `0x${CHAIN.id.toString(16)}`
      if (method === 'eth_getBalance') {
        const addr = String((params as string[])[0]).toLowerCase()
        return `0x${(balances.get(addr) ?? 0n).toString(16)}`
      }
      throw new Error(`unexpected rpc call: ${method}`)
    },
  })
  return {
    transport,
    calls,
    credit(address: string, amount: bigint) {
      const k = address.toLowerCase()
      balances.set(k, (balances.get(k) ?? 0n) + amount)
    },
  }
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
}

function makeRig(
  opts: { mode?: FakeAuthenticatorMode; faucet?: 'grant' | 'reject'; share?: Partial<Rig> } = {},
): Rig {
  const auth = opts.share?.auth ?? new FakeAuthenticator(opts.mode ?? 'ok')
  const chain = opts.share?.chain ?? fakeChain()
  const faucet = fakeFaucet(chain, opts.faucet ?? 'grant')
  const deps: WalletDeps = {
    rpId: RP_ID,
    webAuthnClient: auth.client,
    transport: chain.transport,
    fetchImpl: faucet.impl,
    fundingPoll: { tries: 5, gapMs: 0 },
  }
  return { wallet: new MeraWallet(deps), auth, chain, faucet }
}

let rig: Rig
beforeEach(() => {
  rig = makeRig()
})

describe('通行密钥钱包契约', () => {
  test('未登录时没有账户，也没有签名器', () => {
    expect(rig.wallet.getAccount()).toBeNull()
    expect(rig.wallet.getSigner()).toBeNull()
  })

  test('注册：建一把通行密钥、领到测试币、余额来自 RPC', async () => {
    const out = await rig.wallet.register()
    expect(out.account.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(out.account.label).toBe(`${out.account.address.slice(0, 6)}…${out.account.address.slice(-4)}`)
    expect(rig.auth.size).toBe(1)
    expect(out.faucet.ok).toBe(true)
    expect(rig.faucet.bodies).toEqual([{ chainId: CHAIN.id, address: out.account.address }])
    expect(out.balance).toBe(ONE_MON)
    expect(out.funded).toBe(true)
    expect(rig.chain.calls).toContain('eth_getBalance')
  })

  test('注册与导出全程不往持久存储写任何东西', async () => {
    // 密钥在认证器里、名字也在认证器里，浏览器这边不该留下任何痕迹
    const writes: string[] = []
    const g = globalThis as { localStorage?: unknown }
    const original = g.localStorage
    g.localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => void writes.push(`${k}=${v}`),
      removeItem: () => undefined,
    }
    try {
      await rig.wallet.register({ userName: '小马仔' })
      await rig.wallet.exportMnemonic()
    } finally {
      g.localStorage = original
    }
    expect(writes).toEqual([])
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

  test('注册 → 登出 → 登录，落在同一个地址', async () => {
    const created = await rig.wallet.register()
    rig.wallet.logout()
    expect(rig.wallet.getAccount()).toBeNull()
    expect(rig.wallet.getSigner()).toBeNull()
    // 认证器与本地凭据都还在，登录不需要再创建一把密钥
    const back = await rig.wallet.login()
    expect(back.address).toBe(created.account.address)
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
    expect(out.faucet.ok).toBe(false)
    expect(out.faucet.ok === false && out.faucet.code).toBe('rejected')
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
    })
    const out = await w.register()
    expect(out.faucet.ok).toBe(true)
    expect(out.funded).toBe(false)
    expect(out.balance).toBe(0n)
    expect(bodies).toHaveLength(1)
  })

  test('注册后可以再领一次测试币，余额刷新跟上', async () => {
    const out = await rig.wallet.register()
    const again = await rig.wallet.claimFaucet()
    expect(again.ok).toBe(true)
    expect(rig.faucet.bodies).toHaveLength(2)
    expect(await rig.wallet.refreshBalance()).toBe(2n * ONE_MON)
    expect(out.balance).toBe(ONE_MON)
  })

  test('未登录时读余额与领水都报 locked，而不是打空请求', async () => {
    for (const call of [() => rig.wallet.refreshBalance(), () => rig.wallet.claimFaucet()]) {
      const err = await call().catch((e: unknown) => e)
      expect((err as WalletError).code).toBe('locked')
    }
    expect(rig.faucet.bodies).toHaveLength(0)
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
