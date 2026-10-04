/**
 * L1：分级加载。用假 source，不碰网络也不碰 DOM，输入全部固定。
 * 重点是前台加载和后台预取并发跑的时候，两级的失败记录和在途 promise 不互相踩。
 */
import { describe, expect, test } from 'bun:test'
import { AssetLoader, FailingAssetSource, type LoadProgress } from './loader.ts'
import {
  assertTiered,
  LocalAssetSource,
  type AssetKey,
  type AssetManifest,
  type AssetSource,
  type AssetTier,
  type LoadedAsset,
} from './source.ts'

const MANIFEST: AssetManifest = {
  'b.1': { kind: 'image', path: 'b1.webp', bytes: 10, sha256: 'b1', tier: 'boot' },
  'b.2': { kind: 'image', path: 'b2.webp', bytes: 10, sha256: 'b2', tier: 'boot' },
  'h.1': { kind: 'image', path: 'h1.webp', bytes: 20, sha256: 'h1', tier: 'home' },
  'h.2': { kind: 'image', path: 'h2.webp', bytes: 20, sha256: 'h2', tier: 'home' },
  'h.3': { kind: 'image', path: 'h3.webp', bytes: 20, sha256: 'h3', tier: 'home' },
  'r.1': { kind: 'image', path: 'r1.webp', bytes: 30, sha256: 'r1', tier: 'race' },
  'r.2': { kind: 'image', path: 'r2.webp', bytes: 30, sha256: 'r2', tier: 'race' },
  's.1': { kind: 'image', path: 's1.webp', bytes: 40, sha256: 's1', tier: 'result' },
}

test('character assets remain addressable but do not join whole-tier prefetch', async () => {
  const source = new LocalAssetSource({ ...MANIFEST,
    'art.ponies.8-running': { kind: 'image', path: 'assets/art/ponies/8-running.webp', bytes: 123, sha256: 'sprite', tier: 'race', deferred: true },
  })
  expect(source.keysOf('race')).toEqual(['r.1','r.2'])
  expect(source.keys()).toContain('art.ponies.8-running')
  expect((await source.load('art.ponies.8-running')).url).toBe('/assets/art/ponies/8-running.webp')
})

interface Gate {
  release(key: AssetKey): void
  pending(): AssetKey[]
}

/**
 * 可控 source：记下每个 key 被 load 了几次，可以把某些 key 挂起不 resolve，
 * 用来构造「前台在等、后台同时在跑」这种时序。
 */
class FakeSource implements AssetSource {
  readonly calls: AssetKey[] = []
  private readonly held = new Map<AssetKey, () => void>()

  constructor(private readonly hold: (key: AssetKey) => boolean = () => false) {}

  keys(): AssetKey[] {
    return Object.keys(MANIFEST)
  }

  keysOf(tier: AssetTier): AssetKey[] {
    return Object.keys(MANIFEST).filter((k) => MANIFEST[k]!.tier === tier)
  }

  entry(key: AssetKey) {
    return MANIFEST[key]
  }

  async load(key: AssetKey): Promise<LoadedAsset> {
    this.calls.push(key)
    const e = MANIFEST[key]
    if (!e) throw new Error(`no such key: ${key}`)
    if (this.hold(key)) await new Promise<void>((r) => this.held.set(key, r))
    return { url: `/${e.path}`, bytes: e.bytes }
  }

  gate(): Gate {
    return {
      release: (key) => {
        this.held.get(key)?.()
        this.held.delete(key)
      },
      pending: () => [...this.held.keys()],
    }
  }
}

const count = (calls: AssetKey[], key: AssetKey): number => calls.filter((k) => k === key).length
/** 让已经排队的微任务跑完 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

test('a requested asset subset shares pending jobs with tier loading and reports real failures', async () => {
  const src = new FakeSource(key => key === 'r.1')
  const loader = new AssetLoader(src)
  const tier = loader.loadTier('race')
  const subset = loader.loadKeys(['r.1','r.1'], () => {})
  await settle()
  expect(count(src.calls,'r.1')).toBe(1)
  src.gate().release('r.1')
  expect(await tier).toBe(true)
  expect(await subset).toBe(true)
  let progress: LoadProgress | undefined
  expect(await loader.loadKeys(['no-such-asset'], p => { progress = p })).toBe(false)
  expect(progress?.failures[0]?.key).toBe('no-such-asset')
  expect(progress?.done).toBe(0)
})

describe('tier 切分', () => {
  test('keysOf 按 tier 取，互不重叠且并起来就是全集', () => {
    const src = new LocalAssetSource(MANIFEST)
    expect(src.keysOf('boot')).toEqual(['b.1', 'b.2'])
    expect(src.keysOf('home')).toEqual(['h.1', 'h.2', 'h.3'])
    expect(src.keysOf('race')).toEqual(['r.1', 'r.2'])
    expect(src.keysOf('result')).toEqual(['s.1'])
    const all = (['boot', 'home', 'race', 'result'] as const).flatMap((t) => src.keysOf(t))
    expect(all.sort()).toEqual([...src.keys()].sort())
  })

  test('loadGroup 只加载组内的级，别的级一项都不碰', async () => {
    const src = new FakeSource()
    const loader = new AssetLoader(src)
    const ok = await loader.loadGroup(['boot', 'home'], () => {})
    expect(ok).toBe(true)
    expect(src.calls.sort()).toEqual(['b.1', 'b.2', 'h.1', 'h.2', 'h.3'])
    expect(loader.isTierReady('home')).toBe(true)
    expect(loader.isTierReady('race')).toBe(false)
  })

  test('进度只统计组内的级：100% 真的等于这一组可用了', async () => {
    const src = new FakeSource()
    const loader = new AssetLoader(src)
    const seen: LoadProgress[] = []
    await loader.loadGroup(['boot', 'home'], (p) => seen.push(p))
    const last = seen.at(-1)!
    expect(last.total).toBe(5)
    expect(last.done).toBe(5)
    // 任何一帧都不会出现分母含 race/result 的情况
    expect(seen.every((p) => p.total === 5)).toBe(true)
  })

  test('缺 tier 的清单直接报错，不按最早的级兜底', () => {
    const stale = { 'x.1': { kind: 'image', path: 'x.webp', bytes: 1, sha256: 'x' } } as unknown as AssetManifest
    expect(() => assertTiered(stale)).toThrow(/分级字段/)
    expect(() => assertTiered(MANIFEST)).not.toThrow()
  })
})

describe('并发去重', () => {
  test('同一级并发请求两次只加载一遍', async () => {
    const src = new FakeSource((k) => k === 'r.1')
    const loader = new AssetLoader(src)
    const a = loader.loadTier('race')
    const b = loader.loadTier('race')
    await settle()
    src.gate().release('r.1')
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(count(src.calls, 'r.1')).toBe(1)
    expect(count(src.calls, 'r.2')).toBe(1)
  })

  test('ensureTier 挂到在途的预取上，不另起一轮', async () => {
    const src = new FakeSource((k) => k === 'r.2')
    const loader = new AssetLoader(src)
    const prefetch = loader.loadTier('race')
    await settle()
    const ensure = loader.ensureTier('race')
    src.gate().release('r.2')
    await Promise.all([prefetch, ensure])
    expect(count(src.calls, 'r.2')).toBe(1)
  })

  test('已就绪时 ensureTier 立即返回且不发请求', async () => {
    const src = new FakeSource()
    const loader = new AssetLoader(src)
    await loader.loadTier('result')
    const before = src.calls.length
    expect(loader.isTierReady('result')).toBe(true)
    expect(await loader.ensureTier('result')).toBe(true)
    expect(src.calls.length).toBe(before)
  })

  test('已就绪的项不会被重复请求', async () => {
    const src = new FakeSource()
    const loader = new AssetLoader(src)
    await loader.loadGroup(['boot'], () => {})
    await loader.loadGroup(['boot', 'home'], () => {})
    expect(count(src.calls, 'b.1')).toBe(1)
    expect(count(src.calls, 'h.1')).toBe(1)
  })
})

describe('按 tier 隔离的失败与重试', () => {
  test('一级失败不写进另一级的失败记录', async () => {
    const src = new FailingAssetSource(new FakeSource(), (_k, e) => e?.tier === 'race')
    const loader = new AssetLoader(src)
    expect(await loader.loadGroup(['boot', 'home'], () => {})).toBe(true)
    expect(await loader.loadTier('race')).toBe(false)
    expect(loader.tierFailures('home')).toEqual([])
    expect(loader.tierFailures('race').map((f) => f.key).sort()).toEqual(['r.1', 'r.2'])
    expect(loader.isTierReady('home')).toBe(true)
    expect(loader.isTierReady('race')).toBe(false)
  })

  test('前台失败 + 后台同时在跑：两边的失败清单各归各的，互不覆盖', async () => {
    // home 挂起可控，race 全部失败：后台预取在前台还没结束时就报完错
    const fake = new FakeSource((k) => k === 'h.2')
    const src = new FailingAssetSource(fake, (_k, e) => e?.tier === 'race' || e?.tier === 'home')
    const loader = new AssetLoader(src)

    const seen: LoadProgress[] = []
    const front = loader.loadGroup(['boot', 'home'], (p) => seen.push(p))
    await settle()
    const back = loader.loadTier('race')
    expect(await back).toBe(false)
    expect(await front).toBe(false)

    // 前台的进度里只有 home 的失败，一条 race 的都不能漏进来
    const last = seen.at(-1)!
    expect(last.total).toBe(5)
    // 失败项不算进 done：进度停在 2/5，不会假装跑满
    expect(last.done).toBe(2)
    expect(last.failures.map((f) => f.key).sort()).toEqual(['h.1', 'h.2', 'h.3'])
    expect(loader.tierFailures('race').map((f) => f.key).sort()).toEqual(['r.1', 'r.2'])
  })

  test('重跑一级只补没进缓存的项，且会清掉这一级的旧失败记录', async () => {
    let broken = true
    const fake = new FakeSource()
    const src = new FailingAssetSource(fake, (k) => broken && k === 'h.2')
    const loader = new AssetLoader(src)

    expect(await loader.loadGroup(['home'], () => {})).toBe(false)
    expect(loader.tierFailures('home').map((f) => f.key)).toEqual(['h.2'])

    broken = false
    const seen: LoadProgress[] = []
    expect(await loader.loadGroup(['home'], (p) => seen.push(p))).toBe(true)
    expect(loader.tierFailures('home')).toEqual([])
    expect(loader.isTierReady('home')).toBe(true)
    // 第一遍只有 h.1/h.3 真的落到底层（h.2 在注入层就被拦掉了），
    // 第二遍只补 h.2——三次调用，说明已就绪的项一次都没被重新请求
    expect(fake.calls).toEqual(['h.1', 'h.3', 'h.2'])
    // 重跑的进度从 2/3 起步，不是从 0 起步
    expect(seen[0]!.done).toBe(2)
  })

  test('后台级失败后 ensureTier 会补一次，补成功就放行', async () => {
    let broken = true
    const src = new FailingAssetSource(new FakeSource(), (k) => broken && k === 'r.1')
    const loader = new AssetLoader(src)
    expect(await loader.loadTier('race')).toBe(false)
    broken = false
    expect(await loader.ensureTier('race')).toBe(true)
    expect(loader.tierFailures('race')).toEqual([])
  })

  test('url 表随每一级完成增量长出来', async () => {
    const loader = new AssetLoader(new FakeSource())
    await loader.loadGroup(['boot', 'home'], () => {})
    expect(loader.url('h.1')).toBe('/h1.webp')
    expect(loader.url('r.1')).toBeUndefined()
    await loader.loadTier('race')
    expect(loader.url('r.1')).toBe('/r1.webp')
    expect(loader.loaded.size).toBe(7)
  })
})
