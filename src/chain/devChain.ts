/**
 * 本地开发链（`DEV_CHAIN=anvil bash scripts/dev.sh`）专用的替身：只在 **dev 构建** 且
 * `VITE_DEV_CHAIN=anvil` 时启用。生产构建里 `import.meta.env.DEV` 被静态替换为 false，这些分支整体被摇掉；
 * 它们不读 URL 参数，也不能被链接打开。
 *
 * - `DirectEoaAccount`：用 Mera 根 EOA 直接发普通交易，实现与 Alchemy sma-b 相同的 `CallAccount`。
 *   本地没有 Alchemy 的打包器与赞助策略，游戏账户就是根 EOA 本身。批量调用按顺序逐笔发送、前一笔入块
 *   再估下一笔（开场的「充值 + openSession」因此不是原子的，这只在开发链上成立）。
 *   发送前 eth_estimateGas 失败即抛错，对应 Alchemy 在 prepareCalls 阶段拒绝会回退的调用。
 * - `devFaucet`：`anvil_setBalance` 给账户加 10 MON，代替测试网水龙头。
 */
import {
  createWalletClient,
  numberToHex,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
} from 'viem'
import type { CallAccount, CallProgress, ContractCall } from './alchemy.ts'
import { CHAIN } from './network.ts'

export type DevChain = 'anvil'

export const DEV_CHAIN: DevChain | null =
  import.meta.env?.DEV === true && import.meta.env?.VITE_DEV_CHAIN === 'anvil' ? 'anvil' : null

/** 单笔 gas 上限：真实求时器最坏 solve ≤ 29.8M，anvil 默认块上限 30M。 */
const GAS_CAP = 29_900_000n
const DEV_FAUCET_WEI = 10n * 10n ** 18n

type Reader = Pick<PublicClient, 'estimateGas' | 'estimateFeesPerGas' | 'getTransactionCount' | 'getTransactionReceipt' | 'waitForTransactionReceipt'>

export class DirectEoaAccount implements CallAccount {
  private readonly wallet

  constructor(
    private readonly signer: LocalAccount,
    private readonly client: Reader,
    transport: Transport,
    private readonly receiptTimeoutMs = 30_000,
  ) {
    this.wallet = createWalletClient({ account: signer, chain: CHAIN, transport })
  }

  getAddress(): Address {
    return this.signer.address
  }

  async resolve(): Promise<Address> {
    return this.signer.address
  }

  async send(calls: readonly ContractCall[]): Promise<string> {
    if (calls.length === 0) throw new Error('EMPTY_CALLS')
    const hashes: Hex[] = []
    for (const [i, call] of calls.entries()) {
      const request = { account: this.signer.address, to: call.to, data: call.data, value: call.value ?? 0n }
      const estimated = await this.client.estimateGas(request)
      const gas = estimated * 13n / 10n > GAS_CAP ? GAS_CAP : estimated * 13n / 10n
      const fees = await this.client.estimateFeesPerGas()
      // nonce 与 chainId 显式给出，与根账户迁入同理：不让节点的 eth_fillTransaction 改写费用字段
      const nonce = await this.client.getTransactionCount({ address: this.signer.address, blockTag: 'pending' })
      const hash = await this.wallet.sendTransaction({
        to: call.to, data: call.data, value: call.value ?? 0n, gas, nonce, chainId: CHAIN.id, type: 'eip1559',
        maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      hashes.push(hash)
      if (i + 1 < calls.length) {
        const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: this.receiptTimeoutMs, pollingInterval: 100 })
        if (receipt.status !== 'success') break
      }
    }
    return hashes.join(',')
  }

  async progress(callId: string): Promise<CallProgress> {
    const hashes = callId.split(',') as Hex[]
    const receipts = await Promise.all(hashes.map((hash) => this.client.getTransactionReceipt({ hash }).catch(() => null)))
    if (receipts.some((r) => r === null)) return { state: 'pending', callId }
    const transactionHashes = receipts.map((r) => r!.transactionHash)
    return receipts.every((r) => r!.status === 'success')
      ? { state: 'included', callId, transactionHashes }
      : { state: 'failed', callId, transactionHashes }
  }
}

type RawRequester = { request: (args: { method: string; params: unknown[] }) => Promise<unknown> }

/** anvil 专用领水：当前余额 + 10 MON。 */
export async function devFaucet(client: Pick<PublicClient, 'getBalance'> & { request: unknown }, address: Address): Promise<bigint> {
  const balance = await client.getBalance({ address })
  const next = balance + DEV_FAUCET_WEI
  await (client as unknown as RawRequester).request({ method: 'anvil_setBalance', params: [address, numberToHex(next)] })
  return next
}
