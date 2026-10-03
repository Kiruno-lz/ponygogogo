/**
 * L2 real-transaction check for P3 (会话协议 v2 / 有奖规则 v3): the real PaidRaceSolver behind PonyGame/PonyVault on
 * anvil, against the TS reference solver on the same on-chain inputs. chooseCard stores any well-shaped choice; the
 * settlement solve ignores the ones that break a rule, exactly like the TS solver.
 *
 * Deploys with scripts/DeployPony.s.sol (PONY_SOLVER unset, so the script creates the PaidRaceSolver artifact and
 * checks its rulesetHash), funds the house and opens entry. A test EOA opens sessions; the open and choice block
 * hashes come from RPC; choice seconds come from the TS solver (stopAtPanel / classifyPaidChoice); anvil time is
 * set per block with evm_setNextBlockTimestamp. SessionSettled must equal solvePaidRace field by field.
 *
 * Safety: run with `bun --no-env-file test`, so the repo .env (real deployer key path) is never loaded; only anvil's
 * public development keys are used, the deployer key file under keys/ is deleted right after deployment.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  createPublicClient, createTestClient, createWalletClient, decodeEventLog, defineChain, getAddress, http, parseEther,
  type Abi, type Address, type Hex, type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PaidTier } from '../../../src/race/core/paidProfiles.ts'
import { PAID_RULESET_HASH } from '../../../src/race/paid/cardRules.ts'
import { derivePaidCoreInput, solvePaidRace } from '../../../src/race/paid/race.ts'
import {
  classifyPaidChoice, solvePaidCore, type PaidChoiceSlot, type PaidChoiceSlots, type PaidCoreInput, type PaidSolveResult,
} from '../../../src/race/paid/solver.ts'
import { PAID_STAKE_WEI } from '../../../src/chain/paidStakes.ts'

setDefaultTimeout(180_000)

const ROOT = resolve(import.meta.dir, '../../..')
const FOUNDRY = resolve(homedir(), '.foundry/bin')
// anvil's public development accounts 0 (owner) and 1 (player); never real funds.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const PLAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex
const KEY_FILE = `keys/.p3-anvil-${process.pid}.private`
const STAKES: Record<PaidTier, bigint> = { 1: PAID_STAKE_WEI[1], 2: PAID_STAKE_WEI[2], 3: PAID_STAKE_WEI[3], 4: PAID_STAKE_WEI[4] }
const MULTIPLIER_BPS = [30_000n, 15_000n, 10_000n, 0n, 0n]

type Artifact = { abi: Abi; deployedBytecode: { object: Hex } }
const artifact = (path: string): Artifact => JSON.parse(readFileSync(resolve(ROOT, 'out', path), 'utf8')) as Artifact
const gameAbi = () => artifact('PonyGame.sol/PonyGame.json').abi
const vaultAbi = () => artifact('PonyVault.sol/PonyVault.json').abi
const solverAbi = () => artifact('PaidRaceSolver.sol/PaidRaceSolver.json').abi

type Settled = {
  sessionId: Hex; finishTime: readonly number[]; rawOrder: readonly number[]; settlementOrder: readonly number[]
  playerSettlementRank: number; payout: bigint; digest: Hex; acquired: readonly number[]
}

describe('P3 real PaidRaceSolver × PonyGame on anvil', () => {
  let anvil: ReturnType<typeof Bun.spawn> | null = null
  let rpcUrl = ''
  let solver: Address
  let game: Address
  let vault: Address
  const owner = privateKeyToAccount(OWNER_KEY)
  const player = privateKeyToAccount(PLAYER_KEY)
  const gas: Record<string, bigint> = {}

  const clients = () => {
    const chain = defineChain({
      id: 31337, name: 'anvil', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    })
    return {
      pub: createPublicClient({ chain, transport: http(rpcUrl) }),
      testc: createTestClient({ chain, mode: 'anvil', transport: http(rpcUrl) }),
      playerWallet: createWalletClient({ account: player, chain, transport: http(rpcUrl) }),
    }
  }

  async function latest(): Promise<bigint> {
    return (await clients().pub.getBlock({ blockTag: 'latest' })).timestamp
  }

  /** Sends one player transaction in its own block at `timestamp`; returns the receipt (reverts throw). */
  async function sendAt(timestamp: bigint, address: Address, abi: Abi, functionName: string, args: readonly unknown[],
    value?: bigint): Promise<TransactionReceipt> {
    const c = clients()
    await c.testc.setNextBlockTimestamp({ timestamp })
    const hash = await c.playerWallet.writeContract({ address, abi, functionName, args, value, gas: 29_000_000n } as never)
    const receipt = await c.pub.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
    return receipt
  }

  function eventArgs(receipt: TransactionReceipt, eventName: string): Record<string, unknown> {
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== game) continue
      try {
        const decoded = decodeEventLog({ abi: gameAbi(), data: log.data, topics: log.topics })
        if (decoded.eventName === eventName) return decoded.args as unknown as Record<string, unknown>
      } catch {
        // another event of the Game
      }
    }
    throw new Error(`${eventName} not emitted`)
  }

  beforeAll(async () => {
    const build = Bun.spawnSync([resolve(FOUNDRY, 'forge'), 'build'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    expect(build.exitCode).toBe(0)
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = probe.port
    probe.stop(true)
    rpcUrl = `http://127.0.0.1:${port}`
    anvil = Bun.spawn([resolve(FOUNDRY, 'anvil'), '--port', String(port), '--code-size-limit', '131072', '--silent'], {
      stdout: 'ignore', stderr: 'ignore',
    })
    for (let i = 0; ; ++i) {
      try {
        await clients().pub.getChainId()
        break
      } catch (error) {
        if (i > 200) throw error
        await Bun.sleep(50)
      }
    }
    mkdirSync(resolve(ROOT, 'keys'), { recursive: true })
    writeFileSync(resolve(ROOT, KEY_FILE), `${OWNER_KEY}\n`)
    chmodSync(resolve(ROOT, KEY_FILE), 0o600)
    try {
      const script = Bun.spawnSync([
        resolve(FOUNDRY, 'forge'), 'script', 'scripts/DeployPony.s.sol', '--rpc-url', rpcUrl, '--broadcast', '--slow',
      ], {
        cwd: ROOT, stdout: 'pipe', stderr: 'pipe',
        env: {
          PATH: process.env.PATH ?? '', HOME: homedir(), FOUNDRY_OFFLINE: 'true', ETH_RPC_URL: rpcUrl,
          DEPLOYER_PRIVATE_KEY_PATH: KEY_FILE, HOUSE_FUND_WEI: parseEther('100').toString(), UNPAUSE: '1',
        },
      })
      const out = script.stdout.toString()
      if (script.exitCode !== 0) throw new Error(`DeployPony failed:\n${out}\n${script.stderr.toString()}`)
      const pick = (label: string) => getAddress(new RegExp(`^\\s+${label} (0x[0-9a-fA-F]{40})$`, 'm').exec(out)![1]!)
      solver = pick('solver')
      game = pick('game')
      vault = pick('vault')
    } finally {
      rmSync(resolve(ROOT, KEY_FILE), { force: true })
    }
    await sendAt((await latest()) + 1n, vault, vaultAbi(), 'deposit', [], parseEther('15'))
  })

  afterAll(() => {
    anvil?.kill()
    rmSync(resolve(ROOT, KEY_FILE), { force: true })
    console.log('P3 anvil gas', Object.fromEntries(Object.entries(gas).map(([k, v]) => [k, v.toString()])))
  })

  test('DeployPony deployed the real PaidRaceSolver with the v4 ruleset and bound it to the Game', async () => {
    const { pub } = clients()
    expect(await pub.readContract({ address: solver, abi: solverAbi(), functionName: 'rulesetHash' })).toBe(PAID_RULESET_HASH)
    expect(await pub.readContract({ address: game, abi: gameAbi(), functionName: 'solver' })).toBe(solver)
    expect(await pub.readContract({ address: game, abi: gameAbi(), functionName: 'rulesetHash' })).toBe(PAID_RULESET_HASH)
    expect(await pub.readContract({ address: game, abi: gameAbi(), functionName: 'owner' })).toBe(owner.address)
    // Same size as the artifact (the immutable support address is patched in at deployment) and within EIP-170.
    const code = (await pub.getCode({ address: solver }))!
    expect(code.length).toBe(artifact('PaidRaceSolver.sol/PaidRaceSolver.json').deployedBytecode.object.length)
    expect((code.length - 2) / 2).toBeLessThanOrEqual(24_576)
    const support = await pub.readContract({ address: solver, abi: solverAbi(), functionName: 'support' }) as Address
    expect((await pub.getCode({ address: support }))?.length ?? 0).toBeGreaterThan(2)
  })

  /** Opens a session and returns the TS core input built from the chain's seed, T0 and open block hash. */
  async function open(tier: PaidTier, horseId: number, label: string) {
    const receipt = await sendAt((await latest()) + 3n, game, gameAbi(), 'openSession', [horseId, STAKES[tier]])
    gas[`${label} openSession`] = receipt.gasUsed
    const opened = eventArgs(receipt, 'SessionOpened')
    const sessionId = opened.sessionId as Hex
    const t0 = opened.openedAt as bigint
    expect(opened.rulesetHash).toBe(PAID_RULESET_HASH)
    const openAnchor = (await clients().pub.getBlock({ blockNumber: receipt.blockNumber })).hash!
    const core = derivePaidCoreInput({
      seed: opened.seed as Hex, openAnchor, stakeTier: tier, playerHorseId: horseId, choices: [null, null, null],
    })
    return { sessionId, t0, core }
  }

  /**
   * chooseCard at T0 + txSec; the choice anchor is that block's hash. The Game records it whatever the rules say;
   * `expected` is the TS verdict after the receipt (null = takes effect). Returns the input with the choice recorded.
   */
  async function choose(label: string, sessionId: Hex, t0: bigint, core: PaidCoreInput, k: 1 | 2 | 3, txSec: bigint,
    cardId: number, refreshSlots: number[], expected: string | null = null): Promise<PaidCoreInput> {
    const receipt = await sendAt(t0 + txSec, game, gameAbi(), 'chooseCard', [sessionId, k, cardId, refreshSlots])
    gas[`${label} chooseCard ${k}`] = receipt.gasUsed
    const chosen = eventArgs(receipt, 'CardChosen')
    expect(Number(chosen.checkpoint)).toBe(k)
    expect(BigInt(chosen.txSec as number)).toBe(txSec)
    const anchor = (await clients().pub.getBlock({ blockNumber: receipt.blockNumber })).hash!
    const next = withChoice(core, k, { txSec, cardId, refreshSlots, anchor })
    expect(classifyPaidChoice(next, k).reason).toBe(expected as never)
    return next
  }

  async function settle(label: string, sessionId: Hex, t0: bigint, core: PaidCoreInput, tier: PaidTier): Promise<void> {
    const ts = solvePaidCore(core, { trace: false })
    const finishSec = (ts.finishWall[core.playerHorseId]! + 999n) / 1000n
    await expectRevert(t0 + finishSec - 1n, 'settleSession', [sessionId])
    const onChainInput = await clients().pub.readContract({
      address: game, abi: gameAbi(), functionName: 'raceInput', args: [sessionId],
    }) as { seed: Hex; openAnchor: Hex; choices: readonly { present: boolean; anchor: Hex; txSec: number }[] }
    expect(onChainInput.seed).toBe(core.seed)
    expect(onChainInput.openAnchor).toBe(core.openAnchor)
    const receipt = await sendAt(t0 + finishSec, game, gameAbi(), 'settleSession', [sessionId])
    gas[`${label} settleSession`] = receipt.gasUsed
    const settled = eventArgs(receipt, 'SessionSettled') as unknown as Settled
    expectSettledEqualsTs(settled, ts, tier)
    // The derivation path (solvePaidRace) and the explicit core path agree.
    expect(solvePaidRace({ seed: core.seed, openAnchor: core.openAnchor, stakeTier: tier,
      playerHorseId: core.playerHorseId, choices: core.choices }, { trace: false }).digest).toBe(ts.digest)
  }

  function expectSettledEqualsTs(settled: Settled, ts: PaidSolveResult, tier: PaidTier): void {
    expect(settled.finishTime.map(BigInt)).toEqual(ts.finishTime)
    expect([...settled.rawOrder]).toEqual(ts.rawOrder)
    expect([...settled.settlementOrder]).toEqual(ts.settlementOrder)
    expect(settled.playerSettlementRank).toBe(ts.settlementRank)
    expect(settled.digest).toBe(ts.digest)
    expect([...settled.acquired]).toEqual(ts.acquiredByCheckpoint)
    expect(settled.payout).toBe(STAKES[tier] * MULTIPLIER_BPS[ts.settlementRank - 1]! / 10_000n)
  }

  async function expectRevert(timestamp: bigint, functionName: string, args: readonly unknown[]): Promise<void> {
    const c = clients()
    await c.testc.setNextBlockTimestamp({ timestamp })
    await c.testc.mine({ blocks: 1 })
    await expect(c.pub.simulateContract({
      account: player, address: game, abi: gameAbi(), functionName, args, blockTag: 'latest',
    } as never)).rejects.toThrow()
  }

  test('session A: a real pick at every manual panel, settled; SessionSettled equals solvePaidRace', async () => {
    const tier: PaidTier = 4
    const { sessionId, t0, core: opened } = await open(tier, 3, 'A')
    let core = opened
    let picks = 0
    for (const k of [1, 2, 3] as const) {
      const stop = solvePaidCore(core, { stopAtPanel: k, trace: false })
      if (stop.panel === null || stop.panel.mode !== 'manual') continue
      const txSec = stop.panel.openSec + BigInt(k)
      const probe = solvePaidCore(core, { untilWall: txSec * 1000n, trace: false })
      if (probe.panel?.checkpoint !== k) continue
      const refresh = stop.panel.drawState.refreshCredits > 0 ? [1] : []
      const offer = [...stop.panel.candidates]
      if (refresh.length > 0) offer[1] = core.playerDeck[stop.panel.drawState.tailCursor - 1]!
      core = await choose('A', sessionId, t0, core, k, txSec, offer[k % 3]!, refresh)
      picks++
    }
    expect(picks).toBeGreaterThan(0)
    await settle('A', sessionId, t0, core, tier)
  })

  test('session B: an early second and a card not offered are stored, then ignored by the settlement solve', async () => {
    const tier: PaidTier = 2
    const { sessionId, t0, core: opened } = await open(tier, 0, 'B')
    const first = solvePaidCore(opened, { stopAtPanel: 1, trace: false })
    expect(first.panel?.mode).toBe('manual')
    let core = await choose('B', sessionId, t0, opened, 1, first.panel!.openSec - 1n, 0, [], 'early')
    const second = solvePaidCore(core, { stopAtPanel: 2, trace: false })
    expect(second.panel?.mode).toBe('manual')
    const notOffered = [...Array(26).keys()].map((i) => i + 1).find((c) => !second.panel!.candidates.includes(c))!
    core = await choose('B', sessionId, t0, core, 2, second.panel!.openSec + 2n, notOffered, [], 'not-offered')
    const ts = solvePaidCore(core, { trace: false })
    expect(ts.checkpoints.map((c) => c.invalidReason)).toEqual([2, 10, 0])
    expect(ts.acquiredByCheckpoint.slice(0, 2)).toEqual([0, 0])
    await settle('B', sessionId, t0, core, tier)
  })
})

function withChoice(core: PaidCoreInput, k: 1 | 2 | 3, slot: PaidChoiceSlot): PaidCoreInput {
  const choices = [...core.choices] as [PaidChoiceSlot | null, PaidChoiceSlot | null, PaidChoiceSlot | null]
  choices[k - 1] = slot
  return { ...core, choices: choices as PaidChoiceSlots }
}
