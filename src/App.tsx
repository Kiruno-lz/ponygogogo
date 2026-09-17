/**
 * 页面状态机：Loading → Home → Select(HorseSelect + StakeSelect) → Countdown → Race ↔ CardChoice
 *              → TailRace → Result。入场与结算失败都留在当前页面显示错误，不跳白屏。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioManager } from './assets/audio.ts'
import { AssetLoader, FailingAssetSource, type LoadProgress } from './assets/loader.ts'
import { LocalAssetSource, fetchManifest } from './assets/source.ts'
import { chainPort } from './chain/mock.ts'
import { MON, type AccountInfo } from './chain/port.ts'
import { PAYOUT_TABLE, STAKE_PRESETS } from './race/core/constants.ts'
import { FP } from './race/core/fixed.ts'
import type { RaceResult } from './race/core/types.ts'
import { RaceDriver } from './race/driver.ts'
import { drawPoster, sharePoster } from './export/poster.ts'
import { ResultScreen, type SettleStatus } from './result/ResultScreen.tsx'
import { CollectionScreen } from './ui/CollectionScreen.tsx'
import { HomeScreen } from './ui/HomeScreen.tsx'
import { LoadingScreen } from './ui/LoadingScreen.tsx'
import { RaceScreen } from './ui/RaceScreen.tsx'
import { SelectScreen } from './ui/SelectScreen.tsx'
import { SettingsScreen } from './ui/SettingsScreen.tsx'
import { t } from './ui/i18n.ts'
import { registerAudio } from './ui/sfx.ts'
import { loadSettings, saveSettings, type GameSettings } from './ui/settings.ts'
import { useStage } from './ui/useStage.ts'
import { DESIGN_W, DESIGN_H } from './game/layout.ts'

type Page = 'loading' | 'home' | 'select' | 'race' | 'result' | 'collection' | 'settings'

const EMPTY_PROGRESS: LoadProgress = { total: 0, done: 0, current: null, failures: [] }

function qs(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function App() {
  // 惰性初始化：不能先渲染默认值再用 effect 覆盖，否则挂载时的保存会把已存设置冲掉
  const [settings, setSettings] = useState<GameSettings>(loadSettings)
  const [page, setPage] = useState<Page>('loading')
  const canvasWidth = page === 'home' ? 1611 : DESIGN_W
  const canvasHeight = page === 'home' ? 976 : DESIGN_H
  const stage = useStage(canvasWidth, canvasHeight)
  const [progress, setProgress] = useState<LoadProgress>(EMPTY_PROGRESS)
  const [ready, setReady] = useState(false)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [balance, setBalance] = useState<bigint>(0n)
  const [connecting, setConnecting] = useState(false)
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<string | null>(null)
  const [driver, setDriver] = useState<RaceDriver | null>(null)
  const [stakeTier, setStakeTier] = useState(0)
  const [result, setResult] = useState<RaceResult | null>(null)
  const [settle, setSettle] = useState<SettleStatus>('preparing')
  const [shared, setShared] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loaderRef = useRef<AssetLoader | null>(null)
  const audioRef = useRef<AudioManager | null>(null)
  const urlsRef = useRef<Record<string, string>>({})

  const lang = settings.lang

  useEffect(() => {
    saveSettings(settings)
    audioRef.current?.setSettings(settings)
  }, [settings])

  // 资源加载
  const runLoad = useCallback(async (retry: boolean) => {
    const loader = loaderRef.current
    if (!loader) return
    const ok = retry
      ? await loader.retry(setProgress)
      : await loader.loadAll(loader['source'].keys(), setProgress)
    if (ok) {
      const urls: Record<string, string> = {}
      for (const [k, v] of loader.loaded) urls[k] = v.url
      urlsRef.current = urls
      setReady(true)
    }
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    void (async () => {
      // 清单是进入加载流程的前置数据；卸载被取消或清单不可用时都不继续加载
      const manifest = await fetchManifest(ctl.signal).catch(() => null)
      if (!manifest || ctl.signal.aborted) return
      let source = new LocalAssetSource(manifest) as InstanceType<typeof LocalAssetSource> | FailingAssetSource
      const fail = qs('mockAssetFail')
      if (fail) {
        source = new FailingAssetSource(
          new LocalAssetSource(manifest),
          (k) => k.includes(fail) || fail === 'all',
          (qs('mockAssetFailMode') as '404' | 'timeout' | 'offline') ?? '404',
        )
      }
      const loader = new AssetLoader(source)
      loaderRef.current = loader
      audioRef.current = new AudioManager(loader)
      audioRef.current.setSettings(loadSettings())
      registerAudio(audioRef.current)
      await runLoad(false)
    })()
    return () => ctl.abort()
  }, [runLoad])

  // 钱包 mock
  useEffect(() => {
    setAccount(chainPort.getAccount())
    void chainPort.getBalance().then(setBalance)
  }, [])

  const audio = audioRef.current

  const enterGame = useCallback(() => {
    void audio?.unlock().then(() => audio.playBgm('audio.bgm_home', 0.35))
    setPage('home')
  }, [audio])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const a = await chainPort.connect()
      setAccount(a)
      setBalance(await chainPort.getBalance())
    } finally {
      setConnecting(false)
    }
  }, [])

  const startRace = useCallback(
    async (horseId: number, tier: number) => {
      setEntering(true)
      setEnterError(null)
      try {
        const stake = BigInt(STAKE_PRESETS[tier]!) * MON
        const { seed, raceId } = await chainPort.enterRace(stake)
        setBalance(await chainPort.getBalance())
        const d = new RaceDriver({ seed, playerHorseId: horseId, stakeTier: tier })
        ;(d as unknown as { raceId: string }).raceId = raceId
        setDriver(d)
        setStakeTier(tier)
        setResult(null)
        setSettle('preparing')
        setShared(false)
        setPage('race')
      } catch (err) {
        setEnterError(err instanceof Error ? err.message : String(err))
      } finally {
        setEntering(false)
      }
    },
    [],
  )

  const submitSettle = useCallback(
    async (r: RaceResult, tier: number) => {
      setSettle('submitted')
      try {
        await chainPort.settleRace(r)
        const payout = (BigInt(STAKE_PRESETS[tier]!) * BigInt(PAYOUT_TABLE[r.rank - 1]!)) / BigInt(FP)
        chainPort.credit(payout * MON)
        setBalance(await chainPort.getBalance())
        setSettle('settled')
      } catch {
        setSettle('failed')
      }
    },
    [],
  )

  const onRaceDone = useCallback(() => {
    if (!driver) return
    // 尾场只决定玩家身后电脑马彼此的先后，直接在规则内核里跑完，结果确定且不阻塞
    let guard = 0
    while (!driver.state.raceOver && guard++ < 60000) driver.engine.step([])
    const raceId = (driver as unknown as { raceId?: string }).raceId ?? 'local'
    const r = driver.engine.buildResult(raceId)
    setResult(r)
    setPage('result')
    audio?.stopBgm()
    audio?.play(r.rank <= 2 ? 'audio.jingle_win' : 'audio.jingle_lose', 0.8)
    audio?.play('audio.sfx_result_open', 0.6)
    void submitSettle(r, stakeTier)
  }, [driver, audio, stakeTier, submitSettle])

  const backHome = useCallback(() => {
    setDriver(null)
    setResult(null)
    setEnterError(null)
    setPage('home')
    audio?.setSlowmo(false)
    void audio?.playBgm('audio.bgm_home', 0.35)
  }, [audio])

  const quitRace = useCallback(() => {
    setNotice(t(lang, 'race.hidden'))
    setDriver(null)
    setPage('home')
    audio?.setSlowmo(false)
    setTimeout(() => setNotice(null), 4200)
  }, [audio, lang])

  const doShare = useCallback(async () => {
    if (!result) return
    try {
      const blob = await drawPoster(result, stakeTier, lang, 'x')
      await sharePoster(blob, `Ponygogogo #${result.rank}`)
      setShared(true)
    } catch {
      setShared(false)
    }
  }, [result, stakeTier, lang])

  const stageStyle = useMemo(
    () => ({
      width: canvasWidth,
      height: canvasHeight,
      transform: `scale(${stage.scale})`,
      left: stage.left,
      top: stage.top,
    }),
    [stage, canvasWidth, canvasHeight],
  )

  return (
    <div className={`stage-host${settings.reducedMotion ? ' reduced' : ''}`}>
      <div className="stage" style={stageStyle} data-testid="stage">
        {page === 'loading' && (
          <LoadingScreen
            progress={progress}
            lang={lang}
            ready={ready}
            onRetry={() => void runLoad(true)}
            onEnter={enterGame}
          />
        )}
        {page === 'home' && (
          <HomeScreen
            lang={lang}
            account={account}
            balance={balance}
            connecting={connecting}
            onStart={() => setPage('select')}
            onCollection={() => setPage('collection')}
            onSettings={() => setPage('settings')}
            onConnect={() => void connect()}
            onDisconnect={() => void chainPort.disconnect().then(() => setAccount(null))}
            onToggleLang={() => setSettings((s) => ({ ...s, lang: s.lang === 'zh' ? 'en' : 'zh' }))}
          />
        )}
        {page === 'select' && (
          <SelectScreen
            lang={lang}
            balance={balance}
            entering={entering}
            error={enterError}
            onBack={() => setPage('home')}
            onRace={(h, tier) => void startRace(h, tier)}
          />
        )}
        {page === 'race' && driver && audio && (
          <RaceScreen
            driver={driver}
            lang={lang}
            reducedMotion={settings.reducedMotion}
            audio={audio}
            urls={urlsRef.current}
            stakeTier={stakeTier}
            onDone={onRaceDone}
            onQuit={quitRace}
          />
        )}
        {page === 'result' && result && (
          <ResultScreen
            lang={lang}
            result={result}
            stakeTier={stakeTier}
            settle={settle}
            shared={shared}
            onRetrySettle={() => void submitSettle(result, stakeTier)}
            onAgain={() => {
              setDriver(null)
              setResult(null)
              setPage('select')
            }}
            onHome={backHome}
            onShare={() => void doShare()}
          />
        )}
        {page === 'collection' && <CollectionScreen lang={lang} onBack={() => setPage('home')} />}
        {page === 'settings' && (
          <SettingsScreen
            lang={lang}
            settings={settings}
            onChange={setSettings}
            onBack={() => setPage('home')}
          />
        )}

        {notice && (
          <div
            data-testid="notice"
            className="panel"
            style={{
              position: 'absolute',
              left: 460,
              top: 40,
              width: 680,
              padding: '4px 24px',
              textAlign: 'center',
              fontSize: 20,
              fontWeight: 700,
              zIndex: 200,
            }}
          >
            {notice}
          </div>
        )}
      </div>

      <div className="rotate-blocker" data-testid="rotate-blocker">
        <div style={{ fontSize: 48 }}>📱↻</div>
        <strong style={{ fontSize: 24 }}>{t(lang, 'rotate.title')}</strong>
        <span style={{ opacity: 0.8 }}>{t(lang, 'rotate.body')}</span>
      </div>
    </div>
  )
}
