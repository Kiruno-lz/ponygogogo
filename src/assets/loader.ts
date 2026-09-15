/**
 * 加载器：逐项进度、失败可重试且指明失败项、全部就绪才进首页。
 * 远程加载迟早会失败，这条现在不做，将来接远程时就得重做加载页。
 */
import type { AssetKey, AssetSource, LoadedAsset } from './source.ts'

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

export class AssetLoader {
  private readonly cache = new Map<AssetKey, LoadedAsset>()
  private failures: LoadFailure[] = []

  constructor(private readonly source: AssetSource) {}

  get loaded(): ReadonlyMap<AssetKey, LoadedAsset> {
    return this.cache
  }

  url(key: AssetKey): string | undefined {
    return this.cache.get(key)?.url
  }

  /** 加载全部资源；返回是否全部成功 */
  async loadAll(
    keys: AssetKey[],
    onProgress: (p: LoadProgress) => void,
    concurrency = 6,
  ): Promise<boolean> {
    const todo = keys.filter((k) => !this.cache.has(k))
    this.failures = []
    let done = keys.length - todo.length
    const total = keys.length
    onProgress({ total, done, current: null, failures: [] })

    const queue = [...todo]
    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, async () => {
      for (;;) {
        const key = queue.shift()
        if (key === undefined) return
        try {
          const asset = await this.source.load(key)
          this.cache.set(key, asset)
        } catch (err) {
          this.failures.push({ key, message: err instanceof Error ? err.message : String(err) })
        }
        done++
        onProgress({ total, done, current: key, failures: [...this.failures] })
      }
    })
    await Promise.all(workers)
    return this.failures.length === 0
  }

  /** 只重试失败项 */
  async retry(onProgress: (p: LoadProgress) => void): Promise<boolean> {
    const keys = this.failures.map((f) => f.key)
    if (keys.length === 0) return true
    return this.loadAll(keys, onProgress)
  }

  get lastFailures(): LoadFailure[] {
    return [...this.failures]
  }
}

/** 注入式失败，用于验证加载页的失败路径 */
export class FailingAssetSource implements AssetSource {
  constructor(
    private readonly inner: AssetSource,
    private readonly failKeys: (key: string) => boolean,
    private readonly mode: '404' | 'timeout' | 'offline' = '404',
  ) {}

  keys() {
    return this.inner.keys()
  }

  entry(key: string) {
    return this.inner.entry(key)
  }

  async load(key: string) {
    if (this.failKeys(key)) {
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
