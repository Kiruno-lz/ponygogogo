/**
 * 钱包用例的共用装置：带 PRF 的虚拟认证器 + 假链、假水龙头、假 Alchemy。
 * 跑的是真实的 mera 与 viem 代码路径（含本地签名的迁移交易），但不打真实测试网、
 * 不消耗水龙头额度、不向 Alchemy 申请账户。
 */
import { expect, type Page } from '@playwright/test'
import {
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type TransactionSerialized,
} from 'viem'

export const ONE_MON = 10n ** 18n
/** 假链的基础费；viem 估出的 maxFee = 1.2 × 基础费 + 小费 */
const BASE_FEE = 100n * 10n ** 9n
const PRIORITY_FEE = 2n * 10n ** 9n

/** 与 Alchemy 一样对同一个签名者给出同一个 sma-b：取签名者地址哈希的低 20 字节 */
export function smaFor(signer: string): Address {
  return getAddress(`0x${keccak256(getAddress(signer)).slice(-40)}`)
}

/** 装一个带 PRF 扩展的 CDP 虚拟认证器 */
export async function addAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  })
}

export type ChainStub = {
  faucetCalls: () => number
  faucetAddresses: () => string[]
  alchemyRequests: () => number
  rawTransactions: () => Array<{ from: Address; to: Address; value: bigint }>
  credit: (address: string, amount: bigint) => void
  balanceOf: (address: string) => bigint
}

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }

/**
 * 拦下 RPC、水龙头与 Alchemy。
 * `fund: false` 让水龙头照常受理却永不入账——注册里的余额轮询会一直跑到跑满，
 * 这正是「领水还没结束」那段时间窗口，用来验证那期间的界面状态。
 * `alchemy: 'down'` 让 sma-b 申请失败，验证游戏账户连不上时的降级。
 */
export async function stubChain(
  page: Page,
  { fund = true, alchemy = 'ok' }: { fund?: boolean; alchemy?: 'ok' | 'down' } = {},
): Promise<ChainStub> {
  const balances = new Map<string, bigint>()
  const nonces = new Map<string, number>()
  const receipts = new Map<string, { from: Address; to: Address }>()
  const raw: Array<{ from: Address; to: Address; value: bigint }> = []
  const faucetAddresses: string[] = []
  let alchemyRequests = 0
  let block = 1000
  const key = (a: string) => a.toLowerCase()
  const hex = (v: bigint | number) => `0x${v.toString(16)}`

  await page.route(
    (url) => url.hostname.endsWith('devnads.com'),
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { address?: string }
      if (body.address) faucetAddresses.push(body.address)
      if (fund && body.address) balances.set(key(body.address), (balances.get(key(body.address)) ?? 0n) + ONE_MON)
      await route.fulfill({ status: 200, body: 'queued', headers: { 'access-control-allow-origin': '*' } })
    },
  )

  await page.route(
    (url) => url.hostname === 'api.g.alchemy.com',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...JSON_HEADERS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } })
        return
      }
      const req = JSON.parse(route.request().postData() ?? '{}') as { id: number; method: string; params?: Array<{ signerAddress?: string }> }
      alchemyRequests++
      const reply = (payload: object) => route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }) })
      if (alchemy === 'down') return reply({ error: { code: -32000, message: 'stubbed Alchemy outage' } })
      if (req.method === 'wallet_requestAccount' && req.params?.[0]?.signerAddress) {
        return reply({ result: { accountAddress: smaFor(req.params[0].signerAddress), id: '3061cc5f-1f96-48a9-ab45-41faad2dd23b' } })
      }
      return reply({ error: { code: -32601, message: `stub does not answer ${req.method}` } })
    },
  )

  await page.route(
    (url) => url.hostname.endsWith('monad.xyz'),
    async (route) => {
      const req = JSON.parse(route.request().postData() ?? '{}') as { id: number; method: string; params?: unknown[] }
      const p = req.params ?? []
      const reply = (payload: object) => route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }) })
      switch (req.method) {
        case 'eth_chainId': return reply({ result: hex(10143) })
        case 'eth_blockNumber': return reply({ result: hex(block) })
        case 'eth_getBalance': return reply({ result: hex(balances.get(key(String(p[0]))) ?? 0n) })
        case 'eth_getCode': return reply({ result: '0x' })
        case 'eth_estimateGas': return reply({ result: hex(21_000) })
        case 'eth_maxPriorityFeePerGas': return reply({ result: hex(PRIORITY_FEE) })
        case 'eth_getTransactionCount': return reply({ result: hex(nonces.get(key(String(p[0]))) ?? 0) })
        case 'eth_getBlockByNumber': return reply({ result: {
          number: hex(block), hash: `0x${'12'.repeat(32)}`, parentHash: `0x${'34'.repeat(32)}`, timestamp: hex(1_700_000_000 + block),
          baseFeePerGas: hex(BASE_FEE), gasLimit: hex(150_000_000), gasUsed: '0x0', transactions: [], uncles: [],
          logsBloom: `0x${'00'.repeat(256)}`, miner: `0x${'00'.repeat(20)}`, difficulty: '0x0', totalDifficulty: '0x0',
          extraData: '0x', nonce: '0x0000000000000000', sha3Uncles: `0x${'00'.repeat(32)}`, size: '0x0',
          stateRoot: `0x${'00'.repeat(32)}`, receiptsRoot: `0x${'00'.repeat(32)}`, transactionsRoot: `0x${'00'.repeat(32)}`,
          mixHash: `0x${'00'.repeat(32)}`,
        } })
        case 'eth_sendRawTransaction': {
          const serialized = p[0] as TransactionSerialized
          const tx = parseTransaction(serialized)
          const from = await recoverTransactionAddress({ serializedTransaction: serialized })
          const to = getAddress(tx.to!)
          const have = balances.get(key(from)) ?? 0n
          if (have < tx.value! + tx.gas! * tx.maxFeePerGas!) return reply({ error: { code: -32003, message: 'insufficient funds' } })
          balances.set(key(from), have - tx.value! - tx.gas! * BASE_FEE)
          balances.set(key(to), (balances.get(key(to)) ?? 0n) + tx.value!)
          nonces.set(key(from), (nonces.get(key(from)) ?? 0) + 1)
          const hash = keccak256(serialized)
          raw.push({ from, to, value: tx.value! })
          receipts.set(hash, { from, to })
          block++
          return reply({ result: hash })
        }
        case 'eth_getTransactionReceipt': {
          const r = receipts.get(String(p[0]))
          return reply({ result: r ? {
            transactionHash: p[0], transactionIndex: '0x0', blockHash: `0x${'12'.repeat(32)}`, blockNumber: hex(block),
            from: r.from, to: r.to, cumulativeGasUsed: hex(21_000), gasUsed: hex(21_000), effectiveGasPrice: hex(BASE_FEE),
            contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', type: '0x2',
          } : null })
        }
      }
      return reply({ error: { code: -32601, message: `stub does not answer ${req.method}` } })
    },
  )

  return {
    faucetCalls: () => faucetAddresses.length,
    faucetAddresses: () => [...faucetAddresses],
    alchemyRequests: () => alchemyRequests,
    rawTransactions: () => [...raw],
    credit: (address, amount) => balances.set(key(address), (balances.get(key(address)) ?? 0n) + amount),
    balanceOf: (address) => balances.get(key(address)) ?? 0n,
  }
}

/** 点注册 → 在取名窗口填名字 → 确认，直到钱包牌子出现 */
export async function registerAs(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /^注册|Sign up/ }).first().click()
  await expect(page.getByTestId('register-modal')).toBeVisible()
  await page.getByTestId('register-name').fill(name)
  await page.getByRole('button', { name: /创建通行密钥|Create passkey/ }).click()
  await expect(page.getByTestId('wallet-panel')).toBeVisible({ timeout: 30_000 })
}

/** 读出当前游戏账户（sma-b）与签名账户（根 EOA）的完整地址，读完把面板收起来 */
export async function readAddresses(page: Page): Promise<{ game: string; signer: string }> {
  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-modal')).toBeVisible()
  const game = (await page.getByTestId('wallet-address').innerText()).trim()
  const signer = (await page.getByTestId('wallet-signer-address').innerText()).trim()
  await page.getByRole('button', { name: /^关闭$|^Close$/ }).click()
  await expect(page.getByTestId('wallet-modal')).toBeHidden()
  return { game, signer }
}

/** 读出当前游戏账户（sma-b）的完整地址 */
export async function readAddress(page: Page): Promise<string> {
  return (await readAddresses(page)).game
}

/** 退出登录：入口在首页木牌上，钱包面板里没有这个按钮 */
export async function logout(page: Page): Promise<void> {
  await page.getByTestId('wallet-logout').click()
  await expect(page.getByTestId('wallet-panel')).toBeHidden()
}
