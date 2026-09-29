/**
 * L2 契约测试：资金模块对真实 EVM 语义。
 *
 * 在本测试里起一条 anvil，部署 Foundry 编出的 PonyVault，用一个直接 EOA 实现与 Alchemy sma-b
 * 相同的 `CallAccount` 接口，走 `readFunds` / `depositToVault` / `withdrawFromVault` / `trackCall` 全程。
 * 这样校验的是 ABI、payable 入账、按 wei 记账、回退语义与同块读取，而不是替身的行为。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import type { CallAccount, CallProgress, ContractCall } from '../../../src/chain/alchemy.ts'
import { MON } from '../../../src/chain/amount.ts'
import { depositToVault, readFunds, trackCall, withdrawFromVault, type FundsSnapshot } from '../../../src/chain/funds.ts'
import { readVaultSolvency } from '../../../src/chain/vault.ts'

const ROOT = join(import.meta.dir, '../../..')
const ARTIFACT = join(ROOT, 'out/PonyVault.sol/PonyVault.json')
const SOURCE = join(ROOT, 'contracts/PonyVault.sol')
const ANVIL = join(homedir(), '.foundry/bin/anvil')
const FORGE = join(homedir(), '.foundry/bin/forge')

// anvil 默认助记词的前两个开发账户：公开的测试密钥，只在本地链上有意义
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const PLAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const GAME = '0x000000000000000000000000000000000000Ba5e' as Address

/**
 * 直接 EOA 版的 CallAccount：每个调用一笔普通交易，调用 ID 就是第一笔的哈希。
 * 显式给 gas，免得 viem 预估时就把会回退的交易拦在链下——我们要测的正是链上回退。
 */
class EoaCallAccount implements CallAccount {
  private readonly batches = new Map<string, Hex[]>()
  constructor(private readonly key: Hex, private readonly rpc: string, private readonly client: PublicClient) {}

  getAddress(): Address {
    return privateKeyToAccount(this.key).address
  }

  async send(calls: readonly ContractCall[]): Promise<string> {
    const wallet = createWalletClient({ account: privateKeyToAccount(this.key), chain: foundry, transport: http(this.rpc) })
    const hashes: Hex[] = []
    for (const call of calls) {
      hashes.push(await wallet.sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n, gas: 300_000n }))
    }
    this.batches.set(hashes[0]!, hashes)
    return hashes[0]!
  }

  async progress(callId: string): Promise<CallProgress> {
    const hashes = this.batches.get(callId) ?? []
    const receipts = await Promise.all(hashes.map((hash) => this.client.getTransactionReceipt({ hash }).catch(() => null)))
    if (receipts.some((r) => r === null)) return { state: 'pending', callId }
    const transactionHashes = receipts.map((r) => r!.transactionHash)
    return receipts.every((r) => r!.status === 'success')
      ? { state: 'included', callId, transactionHashes }
      : { state: 'failed', callId, transactionHashes }
  }
}

let anvil: ChildProcess | null = null
let rpc = ''
let client: PublicClient
let vault: Address
let player: EoaCallAccount

async function freePort(): Promise<number> {
  const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const { port } = server
  server.stop(true)
  return port
}

beforeAll(async () => {
  const stale = !existsSync(ARTIFACT) || statSync(ARTIFACT).mtimeMs < statSync(SOURCE).mtimeMs
  if (stale) {
    const built = spawnSync(FORGE, ['build'], { cwd: ROOT, encoding: 'utf8' })
    if (built.status !== 0) throw new Error(`forge build failed:\n${built.stderr}`)
  }
  const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { abi: Abi; bytecode: { object: Hex } }

  const port = await freePort()
  rpc = `http://127.0.0.1:${port}`
  anvil = spawn(ANVIL, ['--port', String(port), '--silent'], { stdio: 'ignore' })
  client = createPublicClient({ chain: foundry, transport: http(rpc) })
  const deadline = Date.now() + 10_000
  for (;;) {
    if (await client.getChainId().then(() => true, () => false)) break
    if (Date.now() > deadline) throw new Error('anvil did not start')
    await Bun.sleep(50)
  }

  const owner = createWalletClient({ account: privateKeyToAccount(OWNER_KEY), chain: foundry, transport: http(rpc) })
  const hash = await owner.deployContract({
    abi: artifact.abi, bytecode: artifact.bytecode.object, args: [GAME, owner.account.address],
  })
  const receipt = await client.waitForTransactionReceipt({ hash })
  vault = receipt.contractAddress!
  player = new EoaCallAccount(PLAYER_KEY, rpc, client)
}, 30_000)

afterAll(() => {
  anvil?.kill('SIGTERM')
  anvil = null
})

const fast = { pollMs: 20, timeoutMs: 5_000 }

describe('资金模块 × 真实 PonyVault（anvil）', () => {
  test('Vault 未配置或地址无代码时报 not-deployed，钱包余额照常读出', async () => {
    const address = player.getAddress()
    const unset = await readFunds(client, null, address)
    expect(unset.vault).toEqual({ state: 'not-deployed', reason: 'unset' })
    expect(unset.wallet).toBe(await client.getBalance({ address, blockNumber: unset.blockNumber }))
    const noCode = await readFunds(client, GAME, address)
    expect(noCode.vault).toEqual({ state: 'not-deployed', reason: 'no-code' })
  })

  test('充值：payable deposit 按 wei 记入可用余额，钱包减少金额加实付 gas', async () => {
    const before = await readFunds(client, vault, player.getAddress())
    expect(before.vault).toEqual({ state: 'ready', address: vault, available: 0n })

    const callId = await depositToVault(player, before, MON)
    const result = await trackCall(player, callId, fast)
    expect(result.state).toBe('included')
    const hash = (result as Extract<CallProgress, { state: 'included' }>).transactionHashes[0]!
    const receipt = await client.getTransactionReceipt({ hash })

    const after = await readFunds(client, vault, player.getAddress())
    expect(after.blockNumber).toBeGreaterThanOrEqual(receipt.blockNumber)
    expect(after.vault).toEqual({ state: 'ready', address: vault, available: MON })
    expect(after.wallet).toBe(before.wallet - MON - receipt.gasUsed * receipt.effectiveGasPrice)
  })

  test('提款：withdraw 把 MON 原路打回账户，Vault 账务守恒', async () => {
    const before = await readFunds(client, vault, player.getAddress())
    const amount = 4n * MON / 10n
    const result = await trackCall(player, await withdrawFromVault(player, before, amount), fast)
    expect(result.state).toBe('included')
    const hash = (result as Extract<CallProgress, { state: 'included' }>).transactionHashes[0]!
    const receipt = await client.getTransactionReceipt({ hash })

    const after = await readFunds(client, vault, player.getAddress())
    expect(after.vault).toEqual({ state: 'ready', address: vault, available: MON - amount })
    expect(after.wallet).toBe(before.wallet + amount - receipt.gasUsed * receipt.effectiveGasPrice)
    const solvency = await readVaultSolvency(client, vault)
    expect(solvency.totalAvailable).toBe(MON - amount)
    expect(solvency.nativeBalance).toBe(solvency.totalAvailable + solvency.totalLocked + solvency.houseLiquidity)
  })

  test('链上回退如实报 failed：过期快照骗过本地校验，合约仍拒绝超额提款', async () => {
    const real = await readFunds(client, vault, player.getAddress())
    const forged: FundsSnapshot = { ...real, vault: { state: 'ready', address: vault, available: 100n * MON } }
    const result = await trackCall(player, await withdrawFromVault(player, forged, 50n * MON), fast)
    expect(result.state).toBe('failed')
    const after = await readFunds(client, vault, player.getAddress())
    expect(after.vault).toEqual(real.vault)
  })
})
