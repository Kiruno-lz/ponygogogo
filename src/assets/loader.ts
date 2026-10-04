/**
 * 分级加载器。进首页只等 boot+home，race/result 在首页渲染之后后台预取，
 * 玩家真的走到那个页面时再用 ensureTier 兜一次底。
 *
 * 三条不变量，前台加载和后台预取并发跑的时候全靠它们不互相踩：
 * 1. 每一级的进度、失败记录、在途 promise 都只属于这一级，绝不共用一份数组；
 * 2. 同一级并发请求挂同一个 promise，不重复发请求；
 * 3. 重跑一级只补没进缓存的项——失败项和从没试过的项是同一回事，不需要单独的重试队列。
 */
import type { AssetKey, AssetSource, AssetTier, LoadedAsset } from './source.ts'

export interface LoadFailure {
  key: AssetKey
  message: string
}

export interface LoadProgress {
  total: number
  done: number
  current: AssetKey | null
  failures: LoadFailure[]
}

interface TierState {
  keys: AssetKey[]
  done: number
  current: AssetKey | null
  failures: LoadFailure[]
  inFlight: Promise<boolean> | null
}

/** 进度订阅只在一次 loadGroup 调用期间存在，各自只汇总自己那几级 */
interface Listener {
  tiers: readonly AssetTier[]
  fn: (p: LoadProgress) => void
}

export class AssetLoader {
  private readonly cache = new Map<AssetKey, LoadedAsset>()
  private readonly state = new Map<AssetTier, TierState>()
  private readonly listeners = new Set<Listener>()
  private readonly keyJobs = new Map<AssetKey, Promise<LoadedAsset>>()

  constructor(private readonly source: AssetSource) {}

  get loaded(): ReadonlyMap<AssetKey, LoadedAsset> {
    return this.cache
  }

  url(key: AssetKey): string | undefined {
    return this.cache.get(key)?.url
  }

  /** 这一级是否全部进了缓存。以缓存为准，不以「试过几项」为准 */
  isTierReady(tier: AssetTier): boolean {
    return this.stateOf(tier).keys.every((k) => this.cache.has(k))
  }

  tierFailures(tier: AssetTier): LoadFailure[] {
    return [...this.stateOf(tier).failures]
  }

  progressOf(tiers: readonly AssetTier[]): LoadProgress {
    let total = 0
    let done = 0
    let current: AssetKey | null = null
    const failures: LoadFailure[] = []
    for (const tier of tiers) {
      const s = this.stateOf(tier)
      total += s.keys.length
      done += s.done
      failures.push(...s.failures)
      if (s.current) current = s.current
    }
    return { total, done, current, failures }
  }

  /**
   * 加载一级。已就绪立即返回；在途则挂同一个 promise。
   * 重跑只补缓存里没有的项，所以它同时也是这一级的重试入口。
   */
  loadTier(tier: AssetTier, concurrency = 6): Promise<boolean> {
    const s = this.stateOf(tier)
    if (s.inFlight) return s.inFlight
    if (this.isTierReady(tier)) return Promise.resolve(true)
    const run = this.runTier(s, concurrency).finally(() => {
      s.inFlight = null
    })
    s.inFlight = run
    return run
  }

  /** 保证这一级就绪。已就绪不发起任何请求；预取失败过的话这里会自动补一次 */
  async ensureTier(tier: AssetTier): Promise<boolean> {
    if (this.isTierReady(tier)) return true
    return this.loadTier(tier)
  }

  /** 按给定顺序逐级加载，进度按整组合并上报。进度到 100% 就意味着这一组真的可用了 */
  async loadGroup(
    tiers: readonly AssetTier[],
    onProgress: (p: LoadProgress) => void,
    concurrency = 6,
  ): Promise<boolean> {
    const listener: Listener = { tiers, fn: onProgress }
    this.listeners.add(listener)
    try {
      onProgress(this.progressOf(tiers))
      let ok = true
      for (const tier of tiers) ok = (await this.loadTier(tier, concurrency)) && ok
      onProgress(this.progressOf(tiers))
      return ok
    } finally {
      this.listeners.delete(listener)
    }
  }

  /** Requested page/roster assets share the same cache and jobs, without widening a whole tier. */
  async loadKeys(keys: readonly AssetKey[], onProgress: (p: LoadProgress) => void, concurrency = 6): Promise<boolean> {
    const unique = [...new Set(keys)]
    const progress: LoadProgress = { total: unique.length, done: 0, current: null, failures: [] }
    const emit = () => onProgress({ ...progress, failures: [...progress.failures] })
    emit()
    const queue = [...unique]
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, async () => {
      for (;;) {
        const key = queue.shift()
        if (key === undefined) return
        try { await this.loadAsset(key); progress.done++ }
        catch (error) { progress.failures.push({ key, message: error instanceof Error ? error.message : String(error) }) }
        progress.current = key
        emit()
      }
    }))
    progress.current = null
    emit()
    return progress.failures.length === 0
  }

  private loadAsset(key: AssetKey): Promise<LoadedAsset> {
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)
    const pending = this.keyJobs.get(key)
    if (pending) return pending
    const job = this.source.load(key).then(asset => { this.cache.set(key, asset); return asset })
      .finally(() => this.keyJobs.delete(key))
    this.keyJobs.set(key, job)
    return job
  }

  private stateOf(tier: AssetTier): TierState {
    let s = this.state.get(tier)
    if (!s) {
      s = { keys: this.source.keysOf(tier), done: 0, current: null, failures: [], inFlight: null }
      this.state.set(tier, s)
    }
    return s
  }

  private async runTier(s: TierState, concurrency: number): Promise<boolean> {
    // 只清这一级的失败记录。别的级正在跑也不受影响
    s.failures = []
    s.current = null
    const queue = s.keys.filter((k) => !this.cache.has(k))
    s.done = s.keys.length - queue.length
    this.emit()

    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(1, queue.length)) },
      async () => {
        for (;;) {
          const key = queue.shift()
          if (key === undefined) return
          try {
            await this.loadAsset(key)
            // done 只数真的进了缓存的项。失败项不计入，所以 100% 永远等于「这一组可用了」
            s.done++
          } catch (err) {
            s.failures.push({ key, message: err instanceof Error ? err.message : String(err) })
          }
          s.current = key
          this.emit()
        }
      },
    )
    await Promise.all(workers)
    s.current = null
    this.emit()
    return s.failures.length === 0
  }

  private emit(): void {
    for (const l of this.listeners) l.fn(this.progressOf(l.tiers))
  }
}

/**
 * 注入式失败，用于验证加载页和分级兜底的失败路径。
 * 判定函数拿得到清单条目，所以可以按 key 也可以按 tier 注入，而这个类本身不认识分级规则。
 */
export class FailingAssetSource implements AssetSource {
  constructor(
    private readonly inner: AssetSource,
    private readonly failKeys: (key: string, entry?: ReturnType<AssetSource['entry']>) => boolean,
    private readonly mode: '404' | 'timeout' | 'offline' = '404',
  ) {}

  keys() {
    return this.inner.keys()
  }

  keysOf(tier: AssetTier) {
    return this.inner.keysOf(tier)
  }

  entry(key: string) {
    return this.inner.entry(key)
  }

  async load(key: string) {
    if (this.failKeys(key, this.inner.entry(key))) {
      if (this.mode === 'timeout') {
        await new Promise((r) => setTimeout(r, 50))
        throw new Error(`网关超时：${key}`)
      }
      if (this.mode === 'offline') throw new Error(`网络不可用：${key}`)
      throw new Error(`资源不存在 (404)：${key}`)
    }
    return this.inner.load(key)
  }
}
