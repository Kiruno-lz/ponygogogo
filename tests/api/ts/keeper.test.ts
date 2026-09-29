/**
 * L2 契约测试：保管人回收脚本 × PonyGame（会话协议 v2，不设退款）。
 * 起一个本地 anvil，部署 MockPaidRaceSolver，再用 scripts/DeployPony.s.sol 真实广播部署 Game/Vault，
 * 然后以真实交易驱动会话，断言 keeper 的判定（从不代玩家结算或封锚；锚过窗后判负原因 1；T0 后 1 天求时器
 * 回退时 owner 判负原因 2；dry-run 只模拟）与链上状态一致。keeper 的人写 ABI 与编译产物逐项比对签名。
 * forge 子进程带 FOUNDRY_OFFLINE=true：它的 Sourcify 追踪查询在本网络会卡住。
 *
 * 安全：Bun 与 forge 都会自动加载仓库 .env（含 Monad RPC 与真实部署密钥路径），本测试一律显式传入配置与
 * 环境，子进程用 `bun --no-env-file`，部署密钥用 anvil 公开的开发私钥写入 keys/ 下的临时文件并在结束时删除。
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { formatAbiItem, formatAbiParams } from 'viem/utils'
import { PAID_RULESET_HASH } from '../../../src/race/paid/cardRules.ts'
import {
  anchorLostAt,
  createKeeper,
  isOverdue,
  keeperGameAbi,
  parseConfig,
  type AnchorFacts,
  type KeeperConfig,
} from '../../../scripts/keeper.ts'

setDefaultTimeout(120_000)

const ROOT = resolve(import.meta.dir, '../../..')
const FOUNDRY = resolve(homedir(), '.foundry/bin')
const ZERO = `0x${'0'.repeat(64)}` as Hex
// anvil's public development accounts 0 and 1; never real funds.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const PLAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex
const KEY_FILE = `keys/.l2-anvil-${process.pid}.private`
const RULESET = PAID_RULESET_HASH
const TIER1 = parseEther('0.3')
const HOUSE = parseEther('10')
const DEPOSIT = parseEther('5')

type Artifact = { abi: Abi; bytecode: { object: Hex } }
const artifact = (path: string): Artifact => JSON.parse(readFileSync(resolve(ROOT, 'out', path), 'utf8')) as Artifact

// ---------------------------------------------------------------------------------------------- pure rules

describe('keeper 判定规则', () => {
  const base = { KEEPER_RPC_URL: 'http://127.0.0.1:1', PONY_GAME: '0x00000000000000000000000000000000000000aa' }

  test('配置校验：RPC、Game 地址、宽限期，send 必须有密钥路径', () => {
    expect(parseConfig(base, []).send).toBe(false)
    expect(parseConfig({ ...base, KEEPER_SEND: '1', DEPLOYER_PRIVATE_KEY_PATH: 'k' }, []).send).toBe(true)
    expect(() => parseConfig({ ...base, KEEPER_RPC_URL: 'ws://x' }, [])).toThrow('INVALID_RPC_URL')
    expect(() => parseConfig({ ...base, PONY_GAME: '0x12' }, [])).toThrow('INVALID_PONY_GAME')
    expect(() => parseConfig({ ...base, KEEPER_GRACE_SEC: '-1' }, [])).toThrow('INVALID_GRACE_SEC')
    expect(() => parseConfig(base, ['--send'])).toThrow('MISSING_DEPLOYER_PRIVATE_KEY_PATH')
  })

  test('宽限期以链上时钟计：settleableAt + grace 当秒即逾期', () => {
    expect(isOverdue(159n, 100n, 60n)).toBe(false)
    expect(isOverdue(160n, 100n, 60n)).toBe(true)
  })

  test('最早未封存锚在块龄 8192 时丢失；全部封存则永不因锚判负', () => {
    const facts = (openAnchor: Hex, choiceAnchor: Hex): AnchorFacts => ({
      openedBlock: 100n,
      openAnchor,
      choices: [
        { present: true, blockNumber: 200n, anchor: choiceAnchor },
        { present: false, blockNumber: 0n, anchor: ZERO },
        { present: false, blockNumber: 0n, anchor: ZERO },
      ],
    })
    expect(anchorLostAt(facts(ZERO, ZERO))).toBe(100n + 8192n)
    expect(anchorLostAt(facts(keccak256('0x01'), ZERO))).toBe(200n + 8192n)
    expect(anchorLostAt(facts(keccak256('0x01'), keccak256('0x02')))).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------- anvil

describe('keeper × PonyGame on anvil', () => {
  let anvil: ReturnType<typeof Bun.spawn> | null = null
  let rpcUrl = ''
  let solver: Address
  let game: Address
  let vault: Address
  const gameAbi = () => artifact('PonyGame.sol/PonyGame.json').abi
  const vaultAbi = () => artifact('PonyVault.sol/PonyVault.json').abi
  const solverAbi = () => artifact('MockPaidRaceSolver.sol/MockPaidRaceSolver.json').abi
  const owner = privateKeyToAccount(OWNER_KEY)
  const player = privateKeyToAccount(PLAYER_KEY)

  const clients = () => {
    const chain = defineChain({
      id: 31337, name: 'anvil', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    })
    return {
      pub: createPublicClient({ chain, transport: http(rpcUrl) }),
      testc: createTestClient({ chain, mode: 'anvil', transport: http(rpcUrl) }),
      ownerWallet: createWalletClient({ account: owner, chain, transport: http(rpcUrl) }),
      playerWallet: createWalletClient({ account: player, chain, transport: http(rpcUrl) }),
    }
  }

  const keeperConfig = (overrides: Partial<KeeperConfig>): KeeperConfig => ({
    rpcUrl, game, fromBlock: 0n, graceSec: 60n, logChunk: 500n, send: false,
    keyPath: null, loop: false, pollMs: 0, ...overrides,
  })
  const forgeEnv = (extra: Record<string, string>) => ({
    PATH: process.env.PATH ?? '', HOME: homedir(), FOUNDRY_OFFLINE: 'true', ETH_RPC_URL: rpcUrl,
    DEPLOYER_PRIVATE_KEY_PATH: KEY_FILE, ...extra,
  })
  const readVault = async (functionName: string, args: readonly unknown[] = []) =>
    await clients().pub.readContract({ address: vault, abi: vaultAbi(), functionName, args } as never) as bigint

  async function lastTimestamp(): Promise<bigint> {
    return (await clients().pub.getBlock({ blockTag: 'latest' })).timestamp
  }

  async function mineAt(timestamp: bigint): Promise<void> {
    const { testc } = clients()
    await testc.setNextBlockTimestamp({ timestamp })
    await testc.mine({ blocks: 1 })
  }

  async function send(wallet: 'owner' | 'player', address: Address, abi: Abi, functionName: string,
    args: readonly unknown[], value?: bigint, at?: bigint): Promise<void> {
    const c = clients()
    if (at !== undefined) await c.testc.setNextBlockTimestamp({ timestamp: at })
    const client = wallet === 'owner' ? c.ownerWallet : c.playerWallet
    const hash = await client.writeContract({ address, abi, functionName, args, value } as never)
    const receipt = await c.pub.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
  }

  async function session(sessionId: Hex) {
    return await clients().pub.readContract({
      address: game, abi: keeperGameAbi, functionName: 'getSession', args: [sessionId],
    })
  }

  async function openSession(horseId: number, at: bigint): Promise<Hex> {
    await send('player', game, gameAbi(), 'openSession', [horseId, TIER1], undefined, at)
    return await clients().pub.readContract({
      address: game, abi: gameAbi(), functionName: 'sessionOf', args: [player.address],
    }) as Hex
  }

  beforeAll(async () => {
    const build = Bun.spawnSync([resolve(FOUNDRY, 'forge'), 'build'], {
      cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: homedir(), FOUNDRY_OFFLINE: 'true' },
    })
    expect(build.exitCode).toBe(0)

    const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = probe.port
    probe.stop(true)
    rpcUrl = `http://127.0.0.1:${port}`
    anvil = Bun.spawn([resolve(FOUNDRY, 'anvil'), '--port', String(port), '--silent'], { stdout: 'ignore', stderr: 'ignore' })
    for (let i = 0; ; ++i) {
      try {
        await clients().pub.getChainId()
        break
      } catch (error) {
        if (i > 100) throw error
        await Bun.sleep(50)
      }
    }

    writeFileSync(resolve(ROOT, KEY_FILE), `${OWNER_KEY}\n`)
    chmodSync(resolve(ROOT, KEY_FILE), 0o600)

    const c = clients()
    const mock = artifact('MockPaidRaceSolver.sol/MockPaidRaceSolver.json')
    const deployHash = await c.ownerWallet.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: [RULESET] })
    solver = getAddress((await c.pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress ?? '')

    const script = Bun.spawnSync([
      resolve(FOUNDRY, 'forge'), 'script', 'scripts/DeployPony.s.sol', '--rpc-url', rpcUrl, '--broadcast',
    ], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: forgeEnv({ PONY_SOLVER: solver, HOUSE_FUND_WEI: HOUSE.toString(), UNPAUSE: '1' }),
    })
    const out = script.stdout.toString()
    expect(script.exitCode).toBe(0)
    game = out.match(/^\s+game (0x[0-9a-fA-F]{40})$/m)?.[1] as Address
    vault = out.match(/^\s+vault (0x[0-9a-fA-F]{40})$/m)?.[1] as Address
    expect(game).toBeDefined()
    expect(vault).toBeDefined()

    await send('player', vault, vaultAbi(), 'deposit', [], DEPOSIT)
  }, 120_000)

  afterAll(() => {
    anvil?.kill()
    rmSync(resolve(ROOT, KEY_FILE), { force: true })
  })

  test('DeployPony 绑定求时器、Game、Vault，注资庄家并开放入场', async () => {
    const { pub } = clients()
    const read = (address: Address, abi: Abi, functionName: string) =>
      pub.readContract({ address, abi, functionName } as never) as Promise<unknown>
    expect(await read(game, gameAbi(), 'solver')).toBe(solver)
    expect(await read(game, gameAbi(), 'vault')).toBe(vault)
    expect(await read(vault, vaultAbi(), 'game')).toBe(game)
    expect(await read(game, gameAbi(), 'rulesetHash')).toBe(RULESET)
    expect(await read(game, gameAbi(), 'entryPaused')).toBe(false)
    expect(await read(game, gameAbi(), 'owner')).toBe(owner.address)
    expect(await read(vault, vaultAbi(), 'houseLiquidity')).toBe(HOUSE)
  })

  test('DeployPony 在广播前拒绝旧规则求时器', async () => {
    const mock = artifact('MockPaidRaceSolver.sol/MockPaidRaceSolver.json')
    const oldHash = keccak256('0x01')
    const tx = await clients().ownerWallet.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: [oldHash] })
    const oldSolver = getAddress((await clients().pub.waitForTransactionReceipt({ hash: tx })).contractAddress ?? '')
    const script = Bun.spawnSync([resolve(FOUNDRY, 'forge'), 'script', 'scripts/DeployPony.s.sol', '--rpc-url', rpcUrl], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: forgeEnv({ PONY_SOLVER: oldSolver, HOUSE_FUND_WEI: '0', UNPAUSE: '0' }),
    })
    expect(script.exitCode).not.toBe(0)
    expect(`${script.stdout}\n${script.stderr}`).toContain('RulesetMismatch')
  })

  test('keeper 的人写 ABI 与编译产物逐项一致（名称、参数、返回值）', () => {
    const compiled = new Map<string, string>()
    for (const item of gameAbi()) {
      if (item.type !== 'function' && item.type !== 'event' && item.type !== 'error') continue
      const outputs = item.type === 'function' ? formatAbiParams(item.outputs) : ''
      compiled.set(`${item.type} ${formatAbiItem(item)}`, outputs)
    }
    for (const item of keeperGameAbi) {
      if (item.type !== 'function' && item.type !== 'event' && item.type !== 'error') continue
      const key = `${item.type} ${formatAbiItem(item)}`
      expect(compiled.has(key)).toBe(true)
      if (item.type === 'function') expect(formatAbiParams(item.outputs)).toBe(compiled.get(key) ?? '')
    }
  })

  test('从不代玩家结算或封锚：冲线逾期但锚仍可读时只等待，玩家随后自行结算', async () => {
    await send('owner', solver, solverAbi(), 'setOutcome', [1, 1, 30_000])
    const t0 = (await lastTimestamp()) + 10n
    const sessionId = await openSession(2, t0)
    const openedBlock = (await session(sessionId)).openedBlock
    await mineAt(t0 + 5n)
    const live = await createKeeper(keeperConfig({ send: true, keyPath: resolve(ROOT, KEY_FILE) }))
    expect(live.sender).toBe(owner.address)
    const lostAtBlock = openedBlock + 8192n
    let report = await live.runOnce()
    expect(report.actions).toEqual([{ kind: 'wait', sessionId, settleableAt: t0 + 30n, readyAt: t0 + 90n, lostAtBlock }])
    await mineAt(t0 + 500n)
    const nonce = await clients().pub.getTransactionCount({ address: owner.address })
    report = await live.runOnce()
    expect(report.actions).toEqual([{ kind: 'wait', sessionId, settleableAt: t0 + 30n, readyAt: t0 + 90n, lostAtBlock }])
    expect(await clients().pub.getTransactionCount({ address: owner.address })).toBe(nonce)
    const s = await session(sessionId)
    expect(s.state).toBe(1)
    expect(s.openAnchor).toBe(ZERO)
    await send('player', game, gameAbi(), 'settleSession', [sessionId])
    expect((await live.runOnce()).actions).toEqual([])
  })

  test('原因 1：所需锚过窗后 dry-run 只模拟，send 判负一次（返还 0，下注进庄家）', async () => {
    const t0 = (await lastTimestamp()) + 10n
    const sessionId = await openSession(3, t0)
    // anvil has no EIP-2935 history contract, so an unsealed anchor is lost after 256 blocks here (8192 on Monad; the
    // exact edge with Monad's bytecode is pinned in tests/contracts/PonyGame.t.sol).
    await clients().testc.mine({ blocks: 300 })
    const dry = await createKeeper(keeperConfig({}))
    expect(dry.sender).toBeNull()
    const nonce = await clients().pub.getTransactionCount({ address: owner.address })
    const report = await dry.runOnce()
    expect(report.actions.filter((a) => a.sessionId === sessionId)).toEqual([{ kind: 'forfeit', sessionId, reason: 1, dryRun: true }])
    expect(await clients().pub.getTransactionCount({ address: owner.address })).toBe(nonce)
    expect((await session(sessionId)).state).toBe(1)

    const houseBefore = await readVault('houseLiquidity')
    const availableBefore = await readVault('available', [player.address])
    const live = await createKeeper(keeperConfig({ send: true, keyPath: resolve(ROOT, KEY_FILE) }))
    const sent = (await live.runOnce()).actions.find((a) => a.sessionId === sessionId)
    expect(sent).toMatchObject({ kind: 'forfeit', sessionId, reason: 1, dryRun: false })
    if (sent?.kind !== 'forfeit') throw new Error('unreachable')
    expect(sent.gasUsed).toBeGreaterThan(0n)
    expect((await session(sessionId)).state).toBe(3)
    expect(await readVault('houseLiquidity')).toBe(houseBefore + TIER1)
    expect(await readVault('available', [player.address])).toBe(availableBefore)
    expect(await readVault('reservedLiquidity')).toBe(0n)
    expect((await live.runOnce()).actions).toEqual([])
  })

  test('原因 2：求时器回退的会话 T0 后 1 天前只等待，之后由 owner 判负', async () => {
    await send('owner', solver, solverAbi(), 'setSolveReverts', [true])
    const t0 = (await lastTimestamp()) + 10n
    const sessionId = await openSession(4, t0)
    const openedBlock = (await session(sessionId)).openedBlock
    await clients().testc.mine({ blocks: 3 })
    const live = await createKeeper(keeperConfig({ send: true, keyPath: resolve(ROOT, KEY_FILE), graceSec: 0n }))
    let report = await live.runOnce()
    expect(report.actions).toEqual([{ kind: 'wait', sessionId, settleableAt: null, readyAt: null, lostAtBlock: openedBlock + 8192n }])

    await mineAt(t0 + 86_400n)
    const dry = await createKeeper(keeperConfig({ graceSec: 0n }))
    expect((await dry.runOnce()).actions).toEqual([{ kind: 'forfeit', sessionId, reason: 2, dryRun: true }])
    report = await live.runOnce()
    expect(report.actions).toMatchObject([{ kind: 'forfeit', sessionId, reason: 2, dryRun: false }])
    expect((await session(sessionId)).state).toBe(3)
    await send('owner', solver, solverAbi(), 'setSolveReverts', [false])
  })

  test('CLI：默认 dry-run 输出 JSON 行且不读密钥；--send 缺密钥路径直接失败', async () => {
    await send('owner', solver, solverAbi(), 'setOutcome', [3, 3, 0])
    const t0 = (await lastTimestamp()) + 10n
    const sessionId = await openSession(1, t0)
    await clients().testc.mine({ blocks: 300 })
    const env = { PATH: process.env.PATH ?? '', HOME: homedir(), KEEPER_RPC_URL: rpcUrl, PONY_GAME: game, KEEPER_GRACE_SEC: '0' }
    const run = Bun.spawnSync(['bun', '--no-env-file', 'scripts/keeper.ts'], { cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe' })
    expect(run.exitCode).toBe(0)
    const lines = run.stdout.toString().trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toContainEqual({ kind: 'forfeit', sessionId, reason: 1, dryRun: true })
    expect(lines.at(-1)).toMatchObject({ kind: 'summary', dryRun: true, sender: null })
    expect((await session(sessionId)).state).toBe(1)

    const refused = Bun.spawnSync(['bun', '--no-env-file', 'scripts/keeper.ts', '--send'], {
      cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe',
    })
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr.toString()).toContain('MISSING_DEPLOYER_PRIVATE_KEY_PATH')
  })
})
