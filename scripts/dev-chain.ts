/**
 * 本地开发链部署：在一条已经起来的 anvil 上部署 求时器 + PonyGame + PonyVault，注资庄家、开放入场，
 * 并把地址写给 Vite（`.env.anvil.local`，`vite --mode anvil` 读取）与 E2E（`.cache/dev-chain/anvil.json`）。
 *
 * 用法（由 `DEV_CHAIN=anvil bash scripts/dev.sh` 调用）：
 *   bun --no-env-file scripts/dev-chain.ts --rpc http://127.0.0.1:8545 [--solver auto|mock|real]
 *
 * - 求时器：`out/PaidRaceSolver.sol/PaidRaceSolver.json` 存在（真实 P3 求时器已编译）就用它，否则部署
 *   tests/contracts/MockPaidRaceSolver.sol 替身，并由 scripts/dev-mock-oracle.ts 按 TS 求时器对齐它的配置。
 * - 密钥：只用 anvil 公开的默认开发账户 0（部署者/庄家），写进 keys/ 下的临时文件给 forge script 读，
 *   部署完立即删除。**不读仓库 .env，不碰真实部署密钥**；forge 子进程显式传入 DEPLOYER_PRIVATE_KEY_PATH 与
 *   RPC，覆盖 .env 里的同名变量。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  createPublicClient, createWalletClient, defineChain, getAddress, http, parseEther, type Abi, type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PAID_RULESET_HASH } from '../src/race/paid/cardRules.ts'

export const ROOT = resolve(import.meta.dir, '..')
export const FOUNDRY_BIN = resolve(homedir(), '.foundry/bin')
/** anvil 默认助记词的开发账户：公开的测试密钥，只在本地链上有意义 */
export const ANVIL_KEYS = {
  owner: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  oracle: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
} as const satisfies Record<string, Hex>

export const VITE_ENV_FILE = resolve(ROOT, '.env.anvil.local')
export const INFO_FILE = resolve(ROOT, '.cache/dev-chain/anvil.json')

export type SolverKind = 'mock' | 'real'

export type DevChainInfo = {
  rpcUrl: string
  chainId: number
  game: Address
  vault: Address
  solver: Address
  solverKind: SolverKind
  rulesetHash: Hex
}

type Artifact = { abi: Abi; bytecode: { object: Hex } }

export function artifact(path: string): Artifact {
  return JSON.parse(readFileSync(resolve(ROOT, 'out', path), 'utf8')) as Artifact
}

export function realSolverBuilt(): boolean {
  return existsSync(resolve(ROOT, 'out/PaidRaceSolver.sol/PaidRaceSolver.json'))
}

export function devClients(rpcUrl: string, chainId: number) {
  const chain = defineChain({
    id: chainId, name: 'anvil', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
  const transport = http(rpcUrl)
  return {
    chain,
    pub: createPublicClient({ chain, transport }),
    owner: createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS.owner), chain, transport }),
    oracle: createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS.oracle), chain, transport }),
  }
}

export async function waitForRpc(rpcUrl: string, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      const body = await res.json() as { result?: string }
      if (body.result) return Number(body.result)
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`RPC ${rpcUrl} did not answer within ${timeoutMs} ms`)
    await Bun.sleep(100)
  }
}

/** 部署并返回地址。solver = auto 时有真实求时器产物就用真实的。 */
export async function deployDevChain(opts: {
  rpcUrl: string
  solver?: 'auto' | SolverKind
  houseFundWei?: bigint
}): Promise<DevChainInfo> {
  const chainId = await waitForRpc(opts.rpcUrl)
  const kind: SolverKind = opts.solver === 'mock' ? 'mock' : opts.solver === 'real' ? 'real' : realSolverBuilt() ? 'real' : 'mock'
  if (kind === 'real' && !realSolverBuilt()) throw new Error('out/PaidRaceSolver.sol/PaidRaceSolver.json missing: run forge build')
  const c = devClients(opts.rpcUrl, chainId)
  let solver: Address | null = null
  if (kind === 'mock') {
    const mock = artifact('MockPaidRaceSolver.sol/MockPaidRaceSolver.json')
    const hash = await c.owner.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: [PAID_RULESET_HASH] })
    const receipt = await c.pub.waitForTransactionReceipt({ hash })
    solver = getAddress(receipt.contractAddress!)
  }
  const keyFile = `keys/.dev-anvil-${process.pid}.private`
  mkdirSync(resolve(ROOT, 'keys'), { recursive: true })
  writeFileSync(resolve(ROOT, keyFile), `${ANVIL_KEYS.owner}\n`)
  chmodSync(resolve(ROOT, keyFile), 0o600)
  try {
    const env: Record<string, string> = {
      // FOUNDRY_OFFLINE: forge's Sourcify trace lookups stall on this network.
      PATH: process.env.PATH ?? '', HOME: homedir(), FOUNDRY_OFFLINE: 'true', ETH_RPC_URL: opts.rpcUrl,
      DEPLOYER_PRIVATE_KEY_PATH: keyFile, HOUSE_FUND_WEI: (opts.houseFundWei ?? parseEther('1000')).toString(), UNPAUSE: '1',
    }
    if (solver) env.PONY_SOLVER = solver
    const run = Bun.spawnSync([
      resolve(FOUNDRY_BIN, 'forge'), 'script', 'scripts/DeployPony.s.sol', '--rpc-url', opts.rpcUrl, '--broadcast',
      '--code-size-limit', '131072', '--slow',
    ], { cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe' })
    const out = run.stdout.toString()
    if (run.exitCode !== 0) throw new Error(`forge script failed:\n${out}\n${run.stderr.toString()}`)
    const pick = (label: string) => {
      const m = new RegExp(`^\\s+${label} (0x[0-9a-fA-F]{40})$`, 'm').exec(out)
      if (!m) throw new Error(`forge script output lacks ${label}:\n${out}`)
      return getAddress(m[1]!)
    }
    return {
      rpcUrl: opts.rpcUrl, chainId, game: pick('game'), vault: pick('vault'), solver: pick('solver'), solverKind: kind,
      rulesetHash: PAID_RULESET_HASH,
    }
  } finally {
    rmSync(resolve(ROOT, keyFile), { force: true })
  }
}

export function writeViteEnv(info: DevChainInfo, path = VITE_ENV_FILE): void {
  writeFileSync(path, [
    '# Generated by scripts/dev-chain.ts for `vite --mode anvil` (DEV_CHAIN=anvil bash scripts/dev.sh). Git-ignored.',
    `VITE_MONAD_RPC_URL=${info.rpcUrl}`,
    `VITE_PONY_GAME_ADDRESS=${info.game}`,
    `VITE_PONY_VAULT_ADDRESS=${info.vault}`,
    'VITE_DEV_CHAIN=anvil',
    'VITE_PAID_RACE_DEV=1',
    '',
  ].join('\n'))
}

export function writeInfo(info: DevChainInfo, path = INFO_FILE): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`)
}

export function readInfo(path = INFO_FILE): DevChainInfo | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DevChainInfo
  } catch {
    return null
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const rpcUrl = arg('--rpc') ?? 'http://127.0.0.1:8545'
  const solver = (arg('--solver') ?? 'auto') as 'auto' | SolverKind
  const info = await deployDevChain({ rpcUrl, solver })
  writeViteEnv(info)
  writeInfo(info)
  console.log(JSON.stringify(info))
}
