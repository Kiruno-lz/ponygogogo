/**
 * L2 契约测试：有奖会话链上层（src/chain/paidSession.ts）× 真实 PonyGame / PonyVault（anvil）。
 *
 * 本测试自己起一条 anvil（chainId 10143 与 Monad 测试网相同、自动出块、按需设定下一块时间戳），用
 * scripts/dev-chain.ts 的同一套部署（forge script scripts/DeployPony.s.sol），以直接 EOA 的 `CallAccount`
 * （src/chain/devChain.ts，开发链上浏览器用的就是它）走 开场 → 选牌 → 结算 → 刷新恢复 全程，断言：
 *
 * - 人写 ABI 与 Foundry 产物逐项一致（名称、参数名、类型、indexed、返回值、结构体字段）；
 * - SessionOpened / CardChosen / SessionSettled 的解析、开场锚与选择锚 = 对应块哈希；
 * - 结果不确定（回执一直查不到）时先读合约：链上已有就按链上事实继续；
 * - 迟到的选择照样上链（Game 只做廉价检查），TS 判定其不生效，结算按无交易处理；结算早于冲线被拒，重复结算从日志取回已结算事实；
 * - 替身求时器下名次与 TS 预览一致；真实 PaidRaceSolver 下 SessionSettled 与 TS `solvePaidRace` 逐字段一致。
 *
 * 安全：`bun --no-env-file test`；只用 anvil 公开开发账户；部署密钥写进 keys/ 下的临时文件并随即删除。
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createPublicClient, createTestClient, createWalletClient, http, parseEther, type Abi, type AbiParameter,
  type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { CallAccount, CallProgress, ContractCall } from '../../../src/chain/alchemy.ts'
import { ChainClock } from '../../../src/chain/chainClock.ts'
import { DirectEoaAccount } from '../../../src/chain/devChain.ts'
import { CHAIN } from '../../../src/chain/network.ts'
import { ponyGameAbi, ponyVaultSessionAbi } from '../../../src/chain/paidCalls.ts'
import {
  choosePaidCard, openPaidSession, PaidSessionError, readSessionFacts, readVaultAvailable, recoverPaidSession,
  settlePaidSession, type PaidChainDeps, type PaidSessionFacts,
} from '../../../src/chain/paidSession.ts'
import { PAID_STAKE_WEI } from '../../../src/chain/paidStakes.ts'
import { compareSettlement, solveFromFacts } from '../../../src/race/paidResult.ts'
import { deployDevChain, FOUNDRY_BIN, realSolverBuilt, ROOT, type DevChainInfo } from '../../../scripts/dev-chain.ts'
import { alignMockSolver, mockSolverAbi, planMockSolver } from '../../../scripts/dev-mock-oracle.ts'

setDefaultTimeout(120_000)

// anvil development accounts 1 and 2 (public keys, local chain only)
const PLAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex
const SECOND_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex
const TIER = 2
const STAKE = PAID_STAKE_WEI[TIER]
const FAST = { pollMs: 20, timeoutMs: 5_000 }

type Artifact = { abi: Abi }
const artifactAbi = (path: string) => (JSON.parse(readFileSync(resolve(ROOT, 'out', path), 'utf8')) as Artifact).abi

// ------------------------------------------------------------------------------------------------ anvil rig

type Rig = {
  anvil: ReturnType<typeof Bun.spawn>
  rpcUrl: string
  info: DevChainInfo
  pub: PublicClient
  testc: ReturnType<typeof createTestClient>
  owner: WalletClient
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
  const port = probe.port!
  probe.stop(true)
  return port
}

async function startRig(solver: 'mock' | 'real'): Promise<Rig> {
  const port = await freePort()
  const rpcUrl = `http://127.0.0.1:${port}`
  const anvil = Bun.spawn([
    resolve(FOUNDRY_BIN, 'anvil'), '--port', String(port), '--chain-id', String(CHAIN.id), '--code-size-limit', '131072',
    '--gas-limit', '60000000', '--silent',
  ], { stdout: 'ignore', stderr: 'ignore' })
  const info = await deployDevChain({ rpcUrl, solver, houseFundWei: parseEther('100') })
  const transport = http(rpcUrl)
  return {
    anvil, rpcUrl, info,
    pub: createPublicClient({ chain: CHAIN, transport }) as PublicClient,
    testc: createTestClient({ chain: CHAIN, mode: 'anvil', transport }),
    owner: createWalletClient({ account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'), chain: CHAIN, transport }),
  }
}

function playerAccount(rig: Rig, key: Hex): DirectEoaAccount {
  return new DirectEoaAccount(privateKeyToAccount(key), rig.pub, http(rig.rpcUrl), 10_000)
}

function deps(rig: Rig, account: CallAccount): PaidChainDeps {
  return { account, client: rig.pub, game: rig.info.game, vault: rig.info.vault, poll: FAST, clock: new ChainClock({ epochOffsetMs: 0 }) }
}

async function latestTimestamp(rig: Rig): Promise<number> {
  return Number((await rig.pub.getBlock({ blockTag: 'latest' })).timestamp)
}

/** The next mined block gets this timestamp (seconds). */
async function atSecond(rig: Rig, sec: number): Promise<void> {
  await rig.testc.setNextBlockTimestamp({ timestamp: BigInt(sec) })
}

function build(paths: string[]): void {
  const run = Bun.spawnSync([resolve(FOUNDRY_BIN, 'forge'), 'build', ...paths], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(`forge build failed:\n${run.stdout}\n${run.stderr}`)
}

// ------------------------------------------------------------------------------------------------ ABI

describe('hand-written ABI matches the Foundry artifacts', () => {
  beforeAll(() => build(['contracts/PonyGame.sol', 'contracts/PonyVault.sol', 'tests/contracts/MockPaidRaceSolver.sol', 'scripts/DeployPony.s.sol']))

  const shape = (p: AbiParameter): unknown => ({
    name: p.name ?? '', type: p.type, indexed: (p as { indexed?: boolean }).indexed ?? false,
    components: 'components' in p && p.components ? p.components.map(shape) : null,
  })
  const key = (item: Abi[number]) => ('name' in item ? `${item.type} ${item.name}(${('inputs' in item ? item.inputs : []).map((i) => i.type).join(',')})` : item.type)

  function check(mine: Abi, compiled: Abi): number {
    const byKey = new Map(compiled.map((i) => [key(i), i]))
    let n = 0
    for (const item of mine) {
      const other = byKey.get(key(item))
      expect(other, key(item)).toBeDefined()
      if (!other) continue
      expect(('inputs' in item ? item.inputs : []).map(shape)).toEqual(('inputs' in other ? other.inputs : []).map(shape))
      if (item.type === 'function' && other.type === 'function') {
        expect(item.outputs.map(shape)).toEqual(other.outputs.map(shape))
        expect(item.stateMutability).toBe(other.stateMutability)
      }
      n++
    }
    return n
  }

  test('PonyGame: every function, event and error the browser uses', () => {
    expect(check(ponyGameAbi as unknown as Abi, artifactAbi('PonyGame.sol/PonyGame.json'))).toBe(ponyGameAbi.length)
  })

  test('PonyVault session subset and the mock solver aligner', () => {
    expect(check(ponyVaultSessionAbi as unknown as Abi, artifactAbi('PonyVault.sol/PonyVault.json'))).toBe(2)
    expect(check(mockSolverAbi as unknown as Abi, artifactAbi('MockPaidRaceSolver.sol/MockPaidRaceSolver.json'))).toBe(4)
  })
})

// ------------------------------------------------------------------------------------------------ mock solver

describe('paid session on anvil (stand-in solver aligned to the TS solver)', () => {
  let rig: Rig
  let player: DirectEoaAccount
  let facts: PaidSessionFacts

  beforeAll(async () => {
    build(['contracts/PonyGame.sol', 'contracts/PonyVault.sol', 'tests/contracts/MockPaidRaceSolver.sol', 'scripts/DeployPony.s.sol'])
    rig = await startRig('mock')
    player = playerAccount(rig, PLAYER_KEY)
  })

  afterAll(() => {
    rig?.anvil.kill()
  })

  test('open: one batch deposits the Vault shortfall and opens; events give sessionId, seed, T0, b0 and the open anchor', async () => {
    const steps: string[] = []
    expect(await readVaultAvailable(rig.pub, rig.info.vault, player.getAddress())).toBe(0n)
    const { facts: opened } = await openPaidSession(deps(rig, player), 3, STAKE, (s) => steps.push(s.phase))
    facts = opened
    expect(steps).toEqual(['signing', 'submitted', 'included'])
    expect(facts).toMatchObject({ player: player.getAddress(), horseId: 3, stakeTier: TIER, stake: STAKE, state: 1 })
    const block = await rig.pub.getBlock({ blockNumber: facts.openedBlock })
    expect(facts.openAnchor).toBe(block.hash)
    expect(facts.openedAt).toBe(Number(block.timestamp))
    // the whole stake came from the wallet and is now locked, nothing left available
    expect(await readVaultAvailable(rig.pub, rig.info.vault, player.getAddress())).toBe(0n)
    expect(await readSessionFacts(rig.pub, rig.info.game, facts.sessionId)).toEqual(facts)
    await alignMockSolver(rig.pub, rig.owner, rig.info.solver, facts)
  })

  test('a second open while the session is unfinished is refused with the active session id', async () => {
    const err = await openPaidSession(deps(rig, player), 1, STAKE).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PaidSessionError)
    expect(err).toMatchObject({ code: 'active-session', sessionId: facts.sessionId })
  })

  test('choose: the tx second is the canonical close; CardChosen and the block hash give the anchor', async () => {
    const plan = solveFromFacts(facts).checkpoints[0]!
    expect(plan.mode).toBe('manual')
    // The open anchor is a real block hash, so the offer varies per run: keep later panels manual (no C-03/C-04).
    const card = plan.candidates.find((c) => c !== 3 && c !== 4)!
    await atSecond(rig, facts.openedAt + Number(plan.openSec) + 1)
    const out = await choosePaidCard(deps(rig, player), facts, 1, card, [])
    expect(out.state).toBe('included')
    if (out.state !== 'included') throw new Error('unreachable')
    expect(out.choice).toMatchObject({ checkpoint: 1, cardId: card, txSec: Number(plan.openSec) + 1, refreshSlots: [] })
    const block = await rig.pub.getBlock({ blockNumber: out.choice.blockNumber })
    expect(out.choice.anchor).toBe(block.hash)
    facts = { ...facts, choices: [out.choice, null, null] }
    await alignMockSolver(rig.pub, rig.owner, rig.info.solver, facts)
  })

  test('a choice after the window is recorded by the Game and judged not to take effect (有奖规则 v3)', async () => {
    const plan = solveFromFacts(facts).checkpoints[1]!
    expect(plan.mode).toBe('manual')
    await atSecond(rig, facts.openedAt + Number(plan.openSec) + 20)
    const out = await choosePaidCard(deps(rig, player), facts, 2, plan.candidates[0]!, [])
    expect(out.state).toBe('included')
    if (out.state !== 'included') throw new Error('unreachable')
    const onChain = await readSessionFacts(rig.pub, rig.info.game, facts.sessionId)
    expect(onChain.choices[1]).toEqual(out.choice)
    facts = { ...facts, choices: [facts.choices[0], out.choice, null] }
    const judged = solveFromFacts(facts).checkpoints[1]!
    expect(judged).toMatchObject({ reason: 'timeout', cardId: 0, invalidReason: 3 })
    await alignMockSolver(rig.pub, rig.owner, rig.info.solver, facts)
  })

  test('uncertain outcome: receipts never show up, the chain record decides', async () => {
    const plan = solveFromFacts(facts).checkpoints[2]!
    expect(plan.mode).toBe('manual')
    const blind: CallAccount = {
      getAddress: () => player.getAddress(),
      send: (calls: readonly ContractCall[]) => player.send(calls),
      progress: async (callId: string): Promise<CallProgress> => ({ state: 'pending', callId }),
    }
    await atSecond(rig, facts.openedAt + Number(plan.openSec))
    const out = await choosePaidCard({ ...deps(rig, blind), poll: { pollMs: 10, timeoutMs: 60 } }, facts, 3, 0, [])
    expect(out.state).toBe('included')
    if (out.state !== 'included') throw new Error('unreachable')
    expect(out.choice).toMatchObject({ checkpoint: 3, cardId: 0, txSec: Number(plan.openSec) })
    expect(out.hash).toBeNull()
    facts = { ...facts, choices: [facts.choices[0], facts.choices[1], out.choice] }
    await alignMockSolver(rig.pub, rig.owner, rig.info.solver, facts)
  })

  test('recovery rebuilds the same facts from sessionOf + getSession + block hashes', async () => {
    const recovered = await recoverPaidSession(rig.pub, rig.info.game, player.getAddress())
    expect(recovered).toEqual(facts)
    expect(await recoverPaidSession(rig.pub, rig.info.game, privateKeyToAccount(SECOND_KEY).address)).toBeNull()
    expect(planMockSolver(recovered!).finishWall).toBe(Number(solveFromFacts(facts).finishWall[3]))
  })

  test('settle: refused before the finish; afterwards SessionSettled carries the TS rank and the Vault pays it', async () => {
    const preview = solveFromFacts(facts)
    const finishWall = Number(preview.finishWall[3])
    await atSecond(rig, facts.openedAt + Math.floor(finishWall / 1000) - 1)
    const early = await settlePaidSession(deps(rig, player), facts)
    expect(early).toMatchObject({ state: 'failed', reason: 'RaceNotFinished' })

    await atSecond(rig, facts.openedAt + Math.ceil(finishWall / 1000))
    const steps: string[] = []
    const out = await settlePaidSession(deps(rig, player), facts, (s) => steps.push(s.phase))
    expect(out.state).toBe('settled')
    if (out.state !== 'settled') throw new Error('unreachable')
    expect(steps).toEqual(['signing', 'submitted', 'included'])
    const s = out.settlement
    expect(s.rank).toBe(preview.settlementRank)
    expect(compareSettlement(s, preview).rank).toBe(true)
    const multipliers = [30_000n, 15_000n, 10_000n, 0n, 0n]
    expect(s.payout).toBe(STAKE * multipliers[s.rank - 1]! / 10_000n)
    expect(s.hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(await readVaultAvailable(rig.pub, rig.info.vault, player.getAddress())).toBe(s.payout)
    expect(await recoverPaidSession(rig.pub, rig.info.game, player.getAddress())).toBeNull()
    expect((await readSessionFacts(rig.pub, rig.info.game, facts.sessionId)).state).toBe(2)

    // a retry after success sends nothing and returns the logged settlement
    const again = await settlePaidSession(deps(rig, player), facts, (st) => steps.push(`again:${st.phase}`))
    expect(again).toEqual(out)
    expect(steps.filter((x) => x.startsWith('again'))).toEqual([])
  })

  test('a second open is funded from the Vault balance alone (no deposit call) once available covers the stake', async () => {
    const before = await readVaultAvailable(rig.pub, rig.info.vault, player.getAddress())
    if (before < STAKE) return
    const { facts: next } = await openPaidSession(deps(rig, player), 0, STAKE)
    expect(await readVaultAvailable(rig.pub, rig.info.vault, player.getAddress())).toBe(before - STAKE)
    expect(next.sessionId).not.toBe(facts.sessionId)
  })
})

// ------------------------------------------------------------------------------------------------ real solver

describe.skipIf(!realSolverBuilt())('paid session on anvil with the real PaidRaceSolver', () => {
  let rig: Rig
  let player: DirectEoaAccount

  beforeAll(async () => {
    rig = await startRig('real')
    player = playerAccount(rig, SECOND_KEY)
  })

  afterAll(() => {
    rig?.anvil.kill()
  })

  test('open → choose at every manual panel → settle: SessionSettled equals the TS solvePaidRace field by field', async () => {
    let { facts } = await openPaidSession(deps(rig, player), 2, STAKE)
    for (const k of [1, 2, 3] as const) {
      const rec = solveFromFacts(facts).checkpoints[k - 1]!
      if (!rec.reached || rec.mode !== 'manual') continue
      await atSecond(rig, Math.max(facts.openedAt + Number(rec.openSec) + 1, (await latestTimestamp(rig)) + 1))
      const out = await choosePaidCard(deps(rig, player), facts, k, rec.candidates[0]!, [])
      expect(out.state).toBe('included')
      if (out.state !== 'included') throw new Error(`choice ${k} not included`)
      const choices = [...facts.choices] as PaidSessionFacts['choices']
      choices[k - 1] = out.choice
      facts = { ...facts, choices }
    }
    const ts = solveFromFacts(facts)
    await atSecond(rig, facts.openedAt + Math.ceil(Number(ts.finishWall[2]) / 1000))
    const out = await settlePaidSession(deps(rig, player), facts)
    expect(out.state).toBe('settled')
    if (out.state !== 'settled') throw new Error('unreachable')
    const s = out.settlement
    expect(s.finishTime.map(BigInt)).toEqual(ts.finishTime)
    expect(s.rawOrder).toEqual(ts.rawOrder)
    expect(s.settlementOrder).toEqual(ts.settlementOrder)
    expect(s.rank).toBe(ts.settlementRank)
    expect(s.digest).toBe(ts.digest)
    expect(compareSettlement(s, ts)).toEqual({ rank: true, full: true })
  })
})
