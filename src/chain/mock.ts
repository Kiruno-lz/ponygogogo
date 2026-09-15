/**
 * ChainPort 的本地 mock。保留完整生命周期与接口形状，不做任何真实调用。
 * seed 由本地 PRNG 生成，支持 URL 参数固定；可注入失败以验证失败路径的 UI 不会卡死。
 */
import { makeSeed } from '../race/core/rng.ts'
import type { RaceResult } from '../race/core/types.ts'
import { MON, type AccountInfo, type ChainPort } from './port.ts'

const LAST_RESULT_KEY = 'ponygogogo:last-result'
const ACCOUNT_KEY = 'ponygogogo:mock-account'

function params(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function delayMs(): number {
  const q = params().get('mockDelay')
  if (q !== null) return Math.max(0, Number(q) || 0)
  return 600
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** localStorage 不可用时（无头环境、隐私模式）退回进程内存，契约行为保持一致 */
const memoryStore = new Map<string, string>()
const store = {
  get(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
    } catch {
      /* 隐私模式下访问会抛错 */
    }
    return memoryStore.get(key) ?? null
  },
  set(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value)
        return
      }
    } catch {
      /* 同上 */
    }
    memoryStore.set(key, value)
  },
  remove(key: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key)
        return
      }
    } catch {
      /* 同上 */
    }
    memoryStore.delete(key)
  },
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export class MockChainPort implements ChainPort {
  private account: AccountInfo | null = null
  private balance = 10n * MON
  private raceSeq = 0

  constructor() {
    const saved = store.get(ACCOUNT_KEY)
    if (saved) {
      try {
        this.account = JSON.parse(saved) as AccountInfo
      } catch {
        this.account = null
      }
    }
  }

  async connect(): Promise<AccountInfo> {
    await sleep(Math.min(delayMs(), 900))
    const hex = randomHex(20)
    this.account = {
      address: '0x' + hex,
      label: '0x' + hex.slice(0, 2).toUpperCase() + '…' + hex.slice(-4),
    }
    store.set(ACCOUNT_KEY, JSON.stringify(this.account))
    return this.account
  }

  async disconnect(): Promise<void> {
    this.account = null
    store.remove(ACCOUNT_KEY)
  }

  getAccount(): AccountInfo | null {
    return this.account
  }

  async getBalance(): Promise<bigint> {
    return this.balance
  }

  async enterRace(stake: bigint): Promise<{ seed: string; raceId: string }> {
    await sleep(delayMs())
    if (params().get('mockFail') === 'enter') {
      throw new Error('ENTER_FAILED')
    }
    if (stake > this.balance) throw new Error('INSUFFICIENT_BALANCE')
    this.balance -= stake
    const forced = params().get('seed')
    const seed = forced && /^0x[0-9a-fA-F]{8,}$/.test(forced) ? forced : makeSeed(Date.now() + this.raceSeq)
    const raceId = `${Date.now().toString(36)}-${(this.raceSeq++).toString(36)}`
    return { seed, raceId }
  }

  async settleRace(result: RaceResult): Promise<{ receiptId: string }> {
    await sleep(delayMs())
    if (params().get('mockFail') === 'settle') {
      throw new Error('SETTLE_FAILED')
    }
    store.set(LAST_RESULT_KEY, JSON.stringify(result))
    // 本地随机串：命名刻意与链上凭据无关、不以 0x 开头、界面不展示
    return { receiptId: 'receipt-' + randomHex(8) }
  }

  /** 结算返还入账（mock：直接加回余额） */
  credit(amount: bigint): void {
    this.balance += amount
  }

  lastResult(): RaceResult | null {
    const raw = store.get(LAST_RESULT_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as RaceResult
    } catch {
      return null
    }
  }
}

export const chainPort = new MockChainPort()
