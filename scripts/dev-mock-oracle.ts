/**
 * 替身求时器对齐器：只在本地开发链、且部署的是 tests/contracts/MockPaidRaceSolver.sol 时运行。
 *
 * 替身不跑比赛规则，它的冲线/名次是可配置的常量（会话协议 v2 下 chooseCard 不调用求时器，替身也不判定选择）。
 * 为了让浏览器 → 链 → 浏览器的完整流程在真实 PaidRaceSolver 之外也能跑通，本脚本监听 PonyGame 的
 * SessionOpened / CardChosen，读出会话事实，用 **同一个 TS 参考求时器**（不合法的已存选择按无交易处理）求出
 * 玩家的 rawRank、settlementRank、finishWall，写回替身。于是结算放行时刻与结算名次都与浏览器预览一致；
 * 五马冲线时间、摘要与 acquired 仍是替身的假值，逐字段相等只在真实求时器上断言（tests/api/ts/paid-session.test.ts）。
 *
 * 用法：bun --no-env-file scripts/dev-mock-oracle.ts [--info .cache/dev-chain/anvil.json] [--poll 250]
 * 只用 anvil 公开开发账户 9 发配置交易。
 */
import { parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem'
import { readSessionFacts, type PaidSessionFacts } from '../src/chain/paidSession.ts'
import { ponyGameAbi } from '../src/chain/paidCalls.ts'
import { solveFromFacts } from '../src/race/paidResult.ts'
import { devClients, readInfo } from './dev-chain.ts'

export const mockSolverAbi = parseAbi([
  'function rawRank() view returns (uint8)',
  'function settlementRank() view returns (uint8)',
  'function finishWall() view returns (uint32)',
  'function setOutcome(uint8 raw, uint8 settled, uint32 wallMs)',
])

export type MockPlan = { raw: number; settled: number; finishWall: number }

/** 纯函数：会话事实 → 替身应有的配置。 */
export function planMockSolver(facts: PaidSessionFacts): MockPlan {
  const r = solveFromFacts(facts)
  return { raw: r.rawRank, settled: r.settlementRank, finishWall: Number(r.finishWall[facts.horseId]!) }
}

/** 只发与当前配置不同的项；nonce 显式递增，同一块内全部落地。返回发出的交易哈希。 */
export async function alignMockSolver(
  pub: PublicClient, wallet: WalletClient, solver: Address, facts: PaidSessionFacts,
): Promise<Hex[]> {
  const plan = planMockSolver(facts)
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address: solver, abi: mockSolverAbi, functionName, args } as never) as Promise<T>
  const [raw, settled, finishWall] = await Promise.all([read<number>('rawRank'), read<number>('settlementRank'), read<number>('finishWall')])
  const account = wallet.account!
  let nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' })
  const hashes: Hex[] = []
  if (raw !== plan.raw || settled !== plan.settled || finishWall !== plan.finishWall) {
    hashes.push(await wallet.writeContract({
      address: solver, abi: mockSolverAbi, functionName: 'setOutcome', args: [plan.raw, plan.settled, plan.finishWall],
      account, chain: wallet.chain, nonce: nonce++, gas: 100_000n,
    }))
  }
  for (const hash of hashes) await pub.waitForTransactionReceipt({ hash, pollingInterval: 100 })
  return hashes
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const info = readInfo(arg('--info'))
  if (!info) throw new Error('dev chain info missing: run scripts/dev-chain.ts first')
  if (info.solverKind !== 'mock') {
    console.log('[oracle] real PaidRaceSolver deployed; nothing to align')
    return
  }
  const pollMs = Number(arg('--poll') ?? 250)
  const c = devClients(info.rpcUrl, info.chainId)
  const pub = c.pub as unknown as PublicClient
  const wallet = c.oracle as unknown as WalletClient
  let from = await c.pub.getBlockNumber()
  const opened = ponyGameAbi.find((i) => i.type === 'event' && i.name === 'SessionOpened')!
  const chosen = ponyGameAbi.find((i) => i.type === 'event' && i.name === 'CardChosen')!
  console.log(`[oracle] aligning mock solver ${info.solver} for game ${info.game} from block ${from}`)
  for (;;) {
    try {
      const head = await c.pub.getBlockNumber()
      if (head >= from) {
        const logs = [
          ...await c.pub.getLogs({ address: info.game, event: opened as never, fromBlock: from, toBlock: head }),
          ...await c.pub.getLogs({ address: info.game, event: chosen as never, fromBlock: from, toBlock: head }),
        ] as unknown as { topics: Hex[] }[]
        const sessions = new Set(logs.map((l) => l.topics[1]!))
        for (const sessionId of sessions) {
          const facts = await readSessionFacts(pub, info.game, sessionId)
          if (facts.state !== 1) continue
          const plan = planMockSolver(facts)
          const sent = await alignMockSolver(pub, wallet, info.solver, facts)
          console.log(`[oracle] ${sessionId.slice(0, 10)} choices=${facts.choices.map((x) => (x ? x.cardId : '-')).join(',')} rank=${plan.settled} finishWall=${plan.finishWall} txs=${sent.length}`)
        }
        from = head + 1n
      }
    } catch (err) {
      console.error(`[oracle] ${err instanceof Error ? err.message : String(err)}`)
    }
    await Bun.sleep(pollMs)
  }
}

if (import.meta.main) {
  void main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
