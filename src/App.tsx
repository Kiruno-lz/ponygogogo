/**
 * 页面状态机：Loading → Home → Select(HorseSelect + StakeSelect) → Countdown → Race ↔ CardChoice
 *              → TailRace → Result。入场与结算失败都留在当前页面显示错误，不跳白屏。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioManager } from './assets/audio.ts'
import { AssetLoader, FailingAssetSource, type LoadProgress } from './assets/loader.ts'
import { LocalAssetSource, fetchManifest, type AssetTier } from './assets/source.ts'
import { chainPort } from './chain/mock.ts'
import { MON } from './chain/port.ts'
import { DEFAULT_PASSKEY_NAME } from './chain/network.ts'
import { wallet, type WalletAccount } from './chain/wallet.ts'
import { PAYOUT_TABLE, STAKE_PRESETS } from './race/core/constants.ts'
import { FP } from './race/core/fixed.ts'
import type { RaceResult } from './race/core/types.ts'
import { RaceDriver } from './race/driver.ts'
import { drawPoster, sharePoster } from './export/poster.ts'
import { ResultScreen, type SettleStatus } from './result/ResultScreen.tsx'
import { CollectionScreen } from './ui/CollectionScreen.tsx'
import { HomeScreen, type WalletBusy } from './ui/HomeScreen.tsx'
import { RegisterModal } from './ui/RegisterModal.tsx'
import { WalletModal } from './ui/WalletModal.tsx'
import { walletErrorText } from './ui/walletError.ts'
import { LoadingScreen } from './ui/LoadingScreen.tsx'
import { RaceScreen } from './ui/RaceScreen.tsx'
import { SelectScreen } from './ui/SelectScreen.tsx'
import { SettingsScreen } from './ui/SettingsScreen.tsx'
import { TierGate } from './ui/TierGate.tsx'
import { t } from './ui/i18n.ts'
import { registerAudio } from './ui/sfx.ts'
import { loadSettings, saveSettings, type GameSettings } from './ui/settings.ts'
import { useStage } from './ui/useStage.ts'
import { DESIGN_W, DESIGN_H } from './game/layout.ts'

type Page = 'loading' | 'home' | 'select' | 'race' | 'result' | 'collection' | 'settings'

const EMPTY_PROGRESS: LoadProgress = { total: 0, done: 0, current: null, failures: [] }

/** 进首页前必须就绪的两级。加载页的 100% 只统计这两级，所以 100% 真的等于「可以进去了」 */
const BLOCKING_TIERS: readonly AssetTier[] = ['boot', 'home']
/** 首页渲染之后后台预取。race 在前：玩家下一步一定是点「开始游戏」 */
const PREFETCH_TIERS: readonly AssetTier[] = ['race', 'result']
/** 每个页面进去之前必须就绪的那一级 */
const PAGE_TIER: Partial<Record<Page, AssetTier>> = {
  select: 'race',
  collection: 'race',
  settings: 'race',
  result: 'result',
}

function qs(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function App() {
  // 惰性初始化：不能先渲染默认值再用 effect 覆盖，否则挂载时的保存会把已存设置冲掉
  const [settings, setSettings] = useState<GameSettings>(loadSettings)
  const [page, setPage] = useState<Page>('loading')
  // 首页与结算页各自对齐自己那张原画的画布，不跟赛道共用一个尺寸
  const canvasWidth = page === 'home' ? 1611 : page === 'result' ? 1620 : DESIGN_W
  const canvasHeight = page === 'home' ? 976 : page === 'result' ? 971 : DESIGN_H
  const stage = useStage(canvasWidth, canvasHeight)
  const [progress, setProgress] = useState<LoadProgress>(EMPTY_PROGRESS)
  const [ready, setReady] = useState(false)
  const [account, setAccount] = useState<WalletAccount | null>(null)
  /** 链上真实余额，只读展示。null = 还没读到，界面显示占位符而不是谎报为 0 */
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null)
  /** 游戏余额，合约上线前是本地账 */
  const [balance, setBalance] = useState<bigint>(0n)
  const [walletBusy, setWalletBusy] = useState<WalletBusy>(null)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletOpen, setWalletOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<string | null>(null)
  const [driver, setDriver] = useState<RaceDriver | null>(null)
  const [stakeTier, setStakeTier] = useState(0)
  const [result, setResult] = useState<RaceResult | null>(null)
  const [settle, setSettle] = useState<SettleStatus>('preparing')
  const [shared, setShared] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * 已就绪资源的 url 表。每完成一级就整体替换一次：RaceScreen 只在挂载时读一次它，
   * 而它进race 页之前已经等过 race 级，所以拿到的一定是全的。
   */
  const [urls, setUrls] = useState<Record<string, string>>({})
  /** 点得比后台预取快、或者预取失败了：正在等哪一级、要去哪一页 */
  const [gate, setGate] = useState<{ tier: AssetTier; to: Page; failed: boolean } | null>(null)
  const [gateProgress, setGateProgress] = useState<LoadProgress>(EMPTY_PROGRESS)
  /** 清单本身取不到时重新走一遍启动流程 */
  const [bootAttempt, setBootAttempt] = useState(0)

  /**
   * 钱包操作的世代号。注册的领水轮询要跑十几秒，期间玩家可以退出、甚至再注册一把；
   * 这个号用来判断一次异步返回是不是仍然属于「当前这一次」，过期的一律丢掉，
   * 免得旧的余额或提示覆盖掉新账户。
   */
  const walletSeq = useRef(0)
  const loaderRef = useRef<AssetLoader | null>(null)
  const audioRef = useRef<AudioManager | null>(null)
  const prefetched = useRef(false)

  const lang = settings.lang

  useEffect(() => {
    saveSettings(settings)
    audioRef.current?.setSettings(settings)
  }, [settings])

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
          failures: [{ key: 'manifest.json', message: manifest.message }],
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
    if (page !== 'home' || prefetched.current) return
    const loader = loaderRef.current
    if (!loader) return
    prefetched.current = true
    void (async () => {
      for (const tier of PREFETCH_TIERS) {
        await loader.loadTier(tier)
        syncUrls()
      }
    })()
  }, [page, syncUrls])

  /**
   * 带就绪保证的跳转。正常情况下预取早跑完了，isTierReady 直接放行，一帧都不耽误；
   * 没跑完就挂上遮罩等同一个在途 promise，失败了给重试入口，底下那一页照常显示。
   */
  const go = useCallback(
    (to: Page) => {
      const tier = PAGE_TIER[to]
      const loader = loaderRef.current
      if (!tier || !loader || loader.isTierReady(tier)) {
        setPage(to)
        return
      }
      setGate({ tier, to, failed: false })
      void (async () => {
        const ok = await loader.loadGroup([tier], setGateProgress)
        syncUrls()
        if (ok) {
          setGate(null)
          setPage(to)
        } else {
          setGate({ tier, to, failed: true })
        }
      })()
    },
    [syncUrls],
  )

  // 游戏余额与钱包余额是两笔账：前者本地模拟，后者读链，互不换算
  useEffect(() => {
    void chainPort.getBalance().then(setBalance)
  }, [])

  const audio = audioRef.current

  const enterGame = useCallback(() => {
    void audio?.unlock().then(() => audio.playBgm('audio.bgm_home', 0.35))
    setPage('home')
  }, [audio])

  /** 注册：用取名窗口给定的用户名建通行密钥 → 派生账户 → 自动领一次测试币 */
  const register = useCallback(async (userName: string) => {
    const seq = ++walletSeq.current
    const current = () => walletSeq.current === seq
    setWalletBusy('register')
    setWalletError(null)
    try {
      const { faucet, balance: b, funded } = await wallet.register({
        userName,
        onAccount: (a) => {
          if (!current()) return
          setAccount(a)
          setRegisterOpen(false)
          // 通行密钥仪式到此结束，后面只剩领水轮询。忙碌态必须在这里放开，
          // 否则轮询那十几秒里玩家一旦退出，首页的登录与注册就全是灰的。
          setWalletBusy(null)
        },
      })
      if (!current()) return
      setWalletBalance(b)
      // 受理不等于到账：只有余额真涨了才说「已到账」
      setNotice(
        !faucet.ok
          ? t(lang, 'wallet.faucetFailed', { detail: faucet.detail })
          : t(lang, funded ? 'wallet.faucetOk' : 'wallet.faucetSlow'),
      )
      setTimeout(() => setNotice(null), 5200)
    } catch (err) {
      if (!current()) return
      setWalletError(walletErrorText(lang, err))
    } finally {
      if (current()) {
        setWalletBusy(null)
        setRegisterOpen(false)
      }
    }
  }, [lang])

  /** 登录：唤起通行密钥，由系统自己列出该域名下的全部，派生出同一个地址 */
  const login = useCallback(async () => {
    const seq = ++walletSeq.current
    const current = () => walletSeq.current === seq
    setWalletBusy('login')
    setWalletError(null)
    try {
      const a = await wallet.login()
      if (!current()) return
      setAccount(a)
      // 余额读不到时留 null：显示「—」，不谎报成 0
      const b = await wallet.refreshBalance().catch(() => null)
      if (current()) setWalletBalance(b)
    } catch (err) {
      if (!current()) return
      setWalletError(walletErrorText(lang, err))
    } finally {
      if (current()) setWalletBusy(null)
    }
  }, [lang])

  const logout = useCallback(() => {
    // 退出即作废所有在途的钱包操作：注册的领水轮询不能在退出之后再把余额写回来
    walletSeq.current++
    setWalletBusy(null)
    wallet.logout()
    setAccount(null)
    setWalletBalance(null)
    setWalletOpen(false)
  }, [])

  const refreshWalletBalance = useCallback(async () => {
    try {
      setWalletBalance(await wallet.refreshBalance())
    } catch (err) {
      setWalletBalance(null)
      throw err
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
    // 结算页的素材是后台预取的，极端情况下要等一下；等的时候比赛画面留在原地，不闪白
    go('result')
    audio?.stopBgm()
    audio?.play(r.rank <= 2 ? 'audio.jingle_win' : 'audio.jingle_lose', 0.8)
    audio?.play('audio.sfx_result_open', 0.6)
    void submitSettle(r, stakeTier)
  }, [driver, audio, stakeTier, submitSettle, go])

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
            onRetry={() => void runBlockingLoad()}
            onEnter={enterGame}
          />
        )}
        {page === 'home' && (
          <HomeScreen
            lang={lang}
            account={account}
            balance={walletBalance}
            busy={walletBusy}
            error={walletError}
            onStart={() => go('select')}
            onCollection={() => go('collection')}
            onSettings={() => go('settings')}
            onRegister={() => {
              setWalletError(null)
              setRegisterOpen(true)
            }}
            onLogin={() => void login()}
            onOpenWallet={() => setWalletOpen(true)}
            onLogout={logout}
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
            urls={urls}
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
              go('select')
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

        {registerOpen && !account && (
          <RegisterModal
            lang={lang}
            defaultName={DEFAULT_PASSKEY_NAME}
            busy={walletBusy === 'register'}
            onConfirm={(userName) => void register(userName)}
            onClose={() => setRegisterOpen(false)}
          />
        )}

        {walletOpen && account && (
          <WalletModal
            lang={lang}
            account={account}
            balance={walletBalance}
            gameBalance={balance}
            onRefresh={refreshWalletBalance}
            onFaucet={() => wallet.claimFaucet()}
            onExport={() => wallet.exportMnemonic()}
            onClose={() => setWalletOpen(false)}
          />
        )}

        {gate && (
          <TierGate
            lang={lang}
            progress={gateProgress}
            waiting={!gate.failed}
            onRetry={() => go(gate.to)}
            onCancel={() => {
              // 比赛已经跑完了，退回去只能回首页；从首页点进来的关掉就是留在首页
              setGate(null)
              if (gate.to === 'result') backHome()
            }}
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
