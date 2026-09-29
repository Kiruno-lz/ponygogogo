/**
 * 链上时钟估计：把本地单调时钟（performance.now 的毫秒）换算成链上时间（Unix 毫秒，区块时间戳是整秒）。
 *
 * 设 offset = 链上时间 − 本地时间。每个观测给 offset 一个区间约束：
 *
 * - **下界**（任何见过的区块都成立）：时间戳为 T 秒的块产出于链上时间 ≥ T·1000，而我们在本地 r 时刻已经
 *   拿到它，所以 chain(r) ≥ T·1000，即 offset ≥ T·1000 − r。选牌交易与结算的回执都是这种观测。
 * - **上界**（只对「请求发出时的链头」成立）：在发出请求的 s 与收到响应的 r 之间某一刻 m，该块还是链头，
 *   而链头最多保持 `headLagMs`（出块间隔 + 节点滞后），且时间戳向下取整最多损失 1000 ms，
 *   故 chain(m) < T·1000 + 1000 + headLagMs，又 chain(s) ≤ chain(m)，即 offset < T·1000 + 1000 + headLagMs − s。
 *
 * 估计值是最近 `windowMs` 内所有观测约束的交集 [lo, hi]：误差界 = (hi − lo)/2，中点用于渲染；
 * 「必须已经过了某一秒」的判定（选牌只能在 openSec 之后发出、结算只能在冲线之后发出）一律用 lo，
 * 「必须还没到某一秒」的判定（选牌截止）一律用 hi。本地时钟漂移（百万分之几十）在窗口内只有毫秒级，忽略。
 * 若交集为空（headLag 估小了或本地时钟跳变），丢弃最早的观测直到一致；只剩下界时 hi = lo + 1000 + headLag。
 *
 * Monad 测试网约 0.35 s 一块，默认 headLagMs = 1000；实测连续轮询时 hi − lo 收敛到约 1 s 以内，
 * 即中点误差 ≤ ±0.5 s 加一次往返时延。
 */

export type ClockSample = {
  /** 区块时间戳（秒） */
  timestampSec: number
  /** 发出请求的本地时刻（ms）；只有 head 观测用到 */
  sentMs: number
  /** 收到响应的本地时刻（ms） */
  receivedMs: number
  /** true = 这是请求时的最新块（给上界）；false = 只知道它已经产出（只给下界） */
  head: boolean
}

export type ClockEstimate = {
  /** 链上时间下界 / 中点 / 上界（Unix ms） */
  lo: number
  mid: number
  hi: number
  /** 中点的误差界（ms） */
  errorMs: number
  /** 是否已有链上观测；否则退回本地系统时钟，界是假设的 ±fallbackErrorMs */
  synced: boolean
}

export type ChainClockOptions = {
  /** 链头最多保持多久（ms）：出块间隔 + 节点滞后 */
  headLagMs?: number
  /** 只用最近这段本地时间内的观测（ms） */
  windowMs?: number
  maxSamples?: number
  /** 尚无观测时退回 Date.now()：本地时钟与链时钟的假设误差 */
  fallbackErrorMs?: number
  /** 本地单调时钟与 Unix 毫秒的换算：Unix ≈ local + epochOffset；测试注入 */
  epochOffsetMs?: number
}

type Bound = { lo: number; hi: number; at: number }

export class ChainClock {
  readonly headLagMs: number
  private readonly windowMs: number
  private readonly maxSamples: number
  private readonly fallbackErrorMs: number
  private readonly epochOffsetMs: number
  private bounds: Bound[] = []

  constructor(opts: ChainClockOptions = {}) {
    this.headLagMs = opts.headLagMs ?? 1000
    this.windowMs = opts.windowMs ?? 120_000
    this.maxSamples = opts.maxSamples ?? 64
    this.fallbackErrorMs = opts.fallbackErrorMs ?? 2000
    this.epochOffsetMs = opts.epochOffsetMs ?? defaultEpochOffset()
  }

  get sampleCount(): number {
    return this.bounds.length
  }

  observe(sample: ClockSample): void {
    const { timestampSec, sentMs, receivedMs, head } = sample
    if (!Number.isFinite(timestampSec) || timestampSec <= 0 || !Number.isFinite(receivedMs)
      || !Number.isFinite(sentMs) || sentMs > receivedMs) return
    const base = timestampSec * 1000
    const lo = base - receivedMs
    const hi = head ? base + 1000 + this.headLagMs - sentMs : Number.POSITIVE_INFINITY
    this.bounds.push({ lo, hi, at: receivedMs })
    const oldest = receivedMs - this.windowMs
    this.bounds = this.bounds.filter((b) => b.at >= oldest).slice(-this.maxSamples)
  }

  /** offset 区间；无观测时为 null */
  offset(): { lo: number; hi: number } | null {
    for (let start = 0; start < this.bounds.length; start++) {
      let lo = Number.NEGATIVE_INFINITY
      let hi = Number.POSITIVE_INFINITY
      for (let i = start; i < this.bounds.length; i++) {
        lo = Math.max(lo, this.bounds[i]!.lo)
        hi = Math.min(hi, this.bounds[i]!.hi)
      }
      if (lo <= hi) {
        if (hi === Number.POSITIVE_INFINITY) hi = lo + 1000 + this.headLagMs
        return { lo, hi }
      }
    }
    return null
  }

  estimate(localMs: number): ClockEstimate {
    const off = this.offset()
    if (off === null) {
      const mid = localMs + this.epochOffsetMs
      return {
        lo: mid - this.fallbackErrorMs, mid, hi: mid + this.fallbackErrorMs, errorMs: this.fallbackErrorMs, synced: false,
      }
    }
    const lo = localMs + off.lo
    const hi = localMs + off.hi
    return { lo, mid: (lo + hi) / 2, hi, errorMs: (hi - lo) / 2, synced: true }
  }
}

function defaultEpochOffset(): number {
  if (typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number') return performance.timeOrigin
  return 0
}

/** 读链头的最小接口；viem PublicClient 满足。 */
export type HeadReader = { getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint }> }

export type ClockSync = { stop(): void; sampleOnce(): Promise<void> }

/**
 * 周期性读链头喂给时钟。单次失败只跳过这一轮；`now` 必须与驱动器用的是同一条本地时间轴
 * （浏览器里就是 performance.now，requestAnimationFrame 的时间戳也在这条轴上）。
 */
export function startClockSync(
  client: HeadReader, clock: ChainClock, opts: { intervalMs?: number; now?: () => number } = {},
): ClockSync {
  const now = opts.now ?? (() => performance.now())
  const intervalMs = opts.intervalMs ?? 2000
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const sampleOnce = async (): Promise<void> => {
    const sentMs = now()
    try {
      const block = await client.getBlock({ blockTag: 'latest' })
      clock.observe({ timestampSec: Number(block.timestamp), sentMs, receivedMs: now(), head: true })
    } catch {
      // 下一轮再试
    }
  }
  const loop = async (): Promise<void> => {
    if (stopped) return
    await sampleOnce()
    if (!stopped) timer = setTimeout(() => void loop(), intervalMs)
  }
  void loop()
  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
    sampleOnce,
  }
}
