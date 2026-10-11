import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioManager } from '../assets/audio.ts'
import { assetFailure } from '../assets/errors.ts'
import { AssetLoader, FailingAssetSource, type LoadProgress } from '../assets/loader.ts'
import { LocalAssetSource, fetchManifest, type AssetTier } from '../assets/source.ts'
import { registerAudio } from '../ui/shared/sfx.ts'
import { loadSettings } from '../ui/settings/settings.ts'
import { queryParameter as qs } from './query.ts'

export const EMPTY_PROGRESS: LoadProgress = { total: 0, done: 0, current: null, failures: [] }
const BLOCKING_TIERS: readonly AssetTier[] = ['boot', 'home']
const PREFETCH_TIERS: readonly AssetTier[] = ['race', 'result']

export function useAssets(home: boolean) {
  const [progress, setProgress] = useState<LoadProgress>(EMPTY_PROGRESS)
  const [ready, setReady] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [bootAttempt, setBootAttempt] = useState(0)
  const loaderRef = useRef<AssetLoader | null>(null)
  const audioRef = useRef<AudioManager | null>(null)
  const prefetched = useRef(false)
  /** 已就绪的 url 整体重建一次。每一级完成后都要调，否则后台预取完的资源拿不到 url */
  const syncUrls = useCallback(() => {
    const loader = loaderRef.current
    if (!loader) return
    const next: Record<string, string> = {}
    for (const [k, v] of loader.loaded) next[k] = v.url
    setUrls(next)
  }, [])

  /** 阻塞级加载。重跑只补没进缓存的项，所以它同时就是加载页那个「重试失败项」 */
  const runBlockingLoad = useCallback(async () => {
    const loader = loaderRef.current
    if (!loader) {
      // 连清单都没拿到，重试得从头走一遍启动
      setBootAttempt((n) => n + 1)
      return
    }
    const ok = await loader.loadGroup(BLOCKING_TIERS, setProgress)
    syncUrls()
    if (ok) setReady(true)
  }, [syncUrls])

  useEffect(() => {
    const ctl = new AbortController()
    void (async () => {
      // 清单是进入加载流程的前置数据；取不到就停在加载页报错，不能静默卡在 0%
      const manifest = await fetchManifest(ctl.signal).catch((err: unknown) => err as Error)
      if (ctl.signal.aborted) return
      if (manifest instanceof Error) {
        setProgress({
          total: 0,
          done: 0,
          current: null,
          failures: [{ key: 'manifest.json', ...assetFailure(manifest) }],
        })
        return
      }
      const failSub = qs('mockAssetFail')
      const failTier = qs('mockAssetFailTier')
      const inner = new LocalAssetSource(manifest)
      const source =
        failSub || failTier
          ? new FailingAssetSource(
            inner,
            (k, e) =>
              (failSub ? failSub === 'all' || k.includes(failSub) : false) ||
              (failTier ? e?.tier === failTier : false),
            (qs('mockAssetFailMode') as '404' | 'timeout' | 'offline') ?? '404',
          )
          : inner
      const loader = new AssetLoader(source)
      loaderRef.current = loader
      audioRef.current = new AudioManager(loader)
      audioRef.current.setSettings(loadSettings())
      registerAudio(audioRef.current)
      await runBlockingLoad()
    })()
    return () => ctl.abort()
  }, [runBlockingLoad, bootAttempt])

  // 首页渲染之后才开始后台预取：不跟阻塞级抢带宽，顺序固定 race → result
  useEffect(() => {
    if (!home || prefetched.current) return
    const loader = loaderRef.current
    if (!loader) return
    prefetched.current = true
    void (async () => {
      for (const tier of PREFETCH_TIERS) {
        await loader.loadTier(tier)
        syncUrls()
      }
    })()
  }, [home, syncUrls])


  return { progress, ready, urls, loaderRef, audioRef, runBlockingLoad, syncUrls }
}
