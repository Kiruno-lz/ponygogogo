/**
 * L2 契约测试：资金模块对真实 EVM 语义。
 *
 * 在本测试里起一条 anvil，部署 Foundry 编出的 PonyVault，用一个直接 EOA 实现与 Alchemy sma-b
 * 相同的 `CallAccount` 接口，验证原生余额快照、庄家储备与已移除的玩家充值入口。
 * 这样校验的是 ABI、庄家 payable 入账、按 wei 记账、回退语义与同块读取，而不是替身的行为。
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
import { readFunds, trackCall } from '../../../src/chain/funds.ts'
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

describe('智能账户原生 MON 与 Vault 储备（anvil）', () => {
  test('wallet funds come directly from the account at the snapshot block', async () => {
    const address = player.getAddress()
    const funds = await readFunds(client, address)
    expect(funds.wallet).toBe(await client.getBalance({ address, blockNumber: funds.blockNumber }))
    expect(Object.keys(funds).sort()).toEqual(['blockNumber', 'player', 'wallet'])
  })

  test('owner funding is reflected in the new L + H solvency invariant', async () => {
    const owner = createWalletClient({ account: privateKeyToAccount(OWNER_KEY), chain: foundry, transport: http(rpc) })
    const abi = JSON.parse(readFileSync(ARTIFACT, 'utf8')).abi as Abi
    const hash = await owner.writeContract({ address: vault, abi, functionName: 'fundHouse', value: MON })
    await client.waitForTransactionReceipt({ hash })
    const state = await readVaultSolvency(client, vault)
    expect(state.houseLiquidity).toBe(MON)
    expect(state.nativeBalance).toBe(state.totalLocked + state.houseLiquidity)
  })

  test('the removed player deposit selector reverts without retaining MON', async () => {
    const before = await client.getBalance({ address: vault })
    const callId = await player.send([{ to: vault, data: '0xd0e30db0', value: MON }])
    expect((await trackCall(player, callId, fast)).state).toBe('failed')
    expect(await client.getBalance({ address: vault })).toBe(before)
  })
})
