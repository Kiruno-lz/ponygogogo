/**
 * 页面状态机：Loading → Home → Select(HorseSelect + StakeSelect) → Countdown → Race ↔ CardChoice
 *              → TailRace → Result。
 *
 * 两种比赛共用这条动线：
 * - 免费本地试玩（档位 0）：本地生成 seed、使用与有奖场相同的事件求时器、结果只在本地展示，不碰任何余额。
 * - 有奖比赛（档位 1–4，只在 chain/paidGate 的 `paidEntry` 开放时可选：构建期地址、链上代码、已登录）：开场交易
 *   → 链上规范时间线上的 P2 求时器画面 → 选牌交易 → 冲线后自动结算 → 结算页以 SessionSettled 为准。
 *   编排在 ui/usePaidRace.ts；登录后若链上还有未完结会话，首页弹出恢复窗口。
 * 钱包显示的是真实资金：游戏账户（sma-b）的原生 MON。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AudioManager } from './assets/audio.ts'
import { AssetLoader, FailingAssetSource, type LoadProgress } from './assets/loader.ts'
import { LocalAssetSource, fetchManifest, type AssetTier } from './assets/source.ts'
import { decryptCollection } from './chain/collectionCipher.ts'
import { readRemoteCollection } from './chain/collectionSync.ts'
import { DEFAULT_PASSKEY_NAME, PONY_GAME_ADDRESS, PONY_VAULT_ADDRESS } from './chain/network.ts'
import { formatMon } from './chain/amount.ts'
import {
  PRACTICE_TIER, isTierPlayable, paidContractsDeployed, paidEntry, paidRaceAvailable, type PaidDeployment,
} from './chain/paidGate.ts'
import { PAID_STAKE_LABELS } from './chain/paidStakes.ts'
import { wallet, type GameAccount, type WalletAccount } from './chain/wallet.ts'
import { practiceRaceId, practiceSeed } from './practice.ts'
import type { RaceResult } from './race/core/types.ts'
import { RaceDriver } from './race/driver.ts'
import type { PaidRaceDriver } from './race/paidDriver.ts'
import { paidChoiceNoteKeys, paidRaceResult, settledChoices } from './race/paidResult.ts'
import type { RaceScreenDriver } from './race/raceView.ts'
import { ResultScreen, type PaidResultView } from './result/ResultScreen.tsx'
import { CollectionScreen } from './ui/CollectionScreen.tsx'
import { HomeScreen, type WalletBusy } from './ui/HomeScreen.tsx'
import { RegisterModal } from './ui/RegisterModal.tsx'
import { WalletModal } from './ui/WalletModal.tsx'
import { walletErrorText } from './ui/walletError.ts'
import { LoadingScreen } from './ui/LoadingScreen.tsx'
import { PaidResumeModal } from './ui/PaidResumeModal.tsx'
import { usePaidRace } from './ui/usePaidRace.ts'
import { RaceScreen } from './ui/RaceScreen.tsx'
import { SelectScreen } from './ui/SelectScreen.tsx'
import { EffectShowcaseScreen } from './ui/EffectShowcaseScreen.tsx'
import { SettingsScreen } from './ui/SettingsScreen.tsx'
import { TierGate } from './ui/TierGate.tsx'
import { t } from './ui/i18n.ts'
import { registerAudio } from './ui/sfx.ts'
import { loadSettings, saveSettings, type GameSettings } from './ui/settings.ts'
import { useGameFunds } from './ui/useGameFunds.ts'
import { useStage } from './ui/useStage.ts'
import { DESIGN_W, DESIGN_H } from './game/layout.ts'

type Page = 'loading' | 'home' | 'select' | 'race' | 'result' | 'collection' | 'settings' | 'effectShowcase'

const EMPTY_PROGRESS: LoadProgress = { total: 0, done: 0, current: null, failures: [] }

/** 进首页前必须就绪的两级。加载页的 100% 只统计这两级，所以 100% 真的等于「可以进去了」 */
const BLOCKING_TIERS: readonly AssetTier[] = ['boot', 'home']
/** 首页渲染之后后台预取。race 在前：玩家下一步一定是点「开始游戏」 */
const PREFETCH_TIERS: readonly AssetTier[] = ['race', 'result']
/** 每个页面进去之前必须就绪的那一级 */
const PAGE_TIER: Partial<Record<Page, AssetTier>> = {
  select: 'race',
  effectShowcase: 'race',
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
  /** 根 EOA：只代表「已登录」，界面不再拿它当游戏账户 */
  const [account, setAccount] = useState<WalletAccount | null>(null)
  /** 游戏账户（sma-b）；解析失败时为 null，错误在 gameError */
  const [gameAccount, setGameAccount] = useState<GameAccount | null>(null)
  const [gameError, setGameError] = useState<string | null>(null)
  const [ownedRareIds, setOwnedRareIds] = useState<string[] | null>(null)
  const [collectionBusy, setCollectionBusy] = useState(false)
  const [collectionError, setCollectionError] = useState<string | null>(null)
  const [walletBusy, setWalletBusy] = useState<WalletBusy>(null)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletOpen, setWalletOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [driver, setDriver] = useState<RaceScreenDriver | null>(null)
  /** 当前这场是有奖比赛时的驱动器（与 driver 同一个对象） */
  const [paidDriver, setPaidDriver] = useState<PaidRaceDriver | null>(null)
  /** 有奖结算页里与链上无关的那部分：下注、预览名次、检查点说明 */
  const [paidMeta, setPaidMeta] = useState<{ stake: bigint; stakeTier: number; stakeLabel: string; previewRank: number; notes: (string | null)[] } | null>(null)
  const [resumeBusy, setResumeBusy] = useState(false)
  /** 有奖合约的链上确认：进选马页时读，读到结论后不再读；读失败保持 checking，下次进选马页再读 */
  const [paidDeployment, setPaidDeployment] = useState<PaidDeployment>('checking')
  const [result, setResult] = useState<RaceResult | null>(null)
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
  /** 本地试玩的局序号，只用于 seed 熵与本地局号 */
  const raceSeq = useRef(0)
  const loaderRef = useRef<AssetLoader | null>(null)
  const audioRef = useRef<AudioManager | null>(null)
  const prefetched = useRef(false)

  const lang = settings.lang
  const funds = useGameFunds(lang)
  const { reset: resetFunds, refresh: refreshFunds } = funds
  const paid = usePaidRace(lang, refreshFunds)
  const { checkResume, reset: resetPaid } = paid
  /** 木牌与选马页显示的「钱包余额」就是 sma-b 的原生 MON；null = 还没读到 */
  const walletBalance = funds.funds?.wallet ?? null
  const paidGate = paidEntry(paidRaceAvailable, paidDeployment, gameAccount !== null)

  useEffect(() => {
    if (page !== 'select' || !paidRaceAvailable || paidDeployment !== 'checking') return
    paidContractsDeployed(wallet.publicClient, PONY_VAULT_ADDRESS!, PONY_GAME_ADDRESS!)
      .then((ok) => setPaidDeployment(ok ? 'deployed' : 'missing'))
      .catch(() => undefined)
  }, [page, paidDeployment])

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

  const audio = audioRef.current

  const enterGame = useCallback(() => {
    void audio?.unlock().then(() => audio.playBgm('audio.bgm_home', 0.35))
    setPage('home')
  }, [audio])

  /** 注册：用取名窗口给定的用户名建通行密钥 → 派生账户 → 自动领一次测试币 */
  const register = useCallback(async (userName: string) => {
    const seq = ++walletSeq.current
    const current = () => walletSeq.current === seq
    setOwnedRareIds(null)
    setCollectionError(null)
    setWalletBusy('register')
    setWalletError(null)
    setGameAccount(null)
    setGameError(null)
    resetFunds()
    try {
      const { game, gameError: resolveError, faucet, funded } = await wallet.register({
        userName,
        onAccount: (a) => {
          if (!current()) return
          setAccount(a)
          setRegisterOpen(false)
          // 通行密钥仪式到此结束，后面只剩解析 sma-b 与领水轮询。忙碌态必须在这里放开，
          // 否则轮询那十几秒里玩家一旦退出，首页的登录与注册就全是灰的。
          setWalletBusy(null)
        },
        onGameAccount: (g) => {
          if (current()) setGameAccount(g)
        },
      })
      if (!current()) return
      if (!game) {
        // 通行密钥已经建好，只是游戏账户暂时连不上：不领水（测试币只发给 sma-b），提示稍后刷新
        const text = walletErrorText(lang, resolveError)
        setGameError(text)
        setNotice(text)
      } else {
        await refreshFunds().catch(() => undefined)
        if (!current()) return
        // 受理不等于到账：只有余额真涨了才说「已到账」
        setNotice(
          !faucet?.ok
            ? t(lang, 'wallet.faucetFailed', { detail: faucet?.detail ?? '' })
            : t(lang, funded ? 'wallet.faucetOk' : 'wallet.faucetSlow'),
        )
      }
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
  }, [lang, resetFunds, refreshFunds])

  /** 解析 sma-b 并读一次资金；失败只记在钱包里，不影响登录本身 */
  const connectGame = useCallback(async (current: () => boolean) => {
    try {
      const g = await wallet.resolveGameAccount()
      if (!current()) return
      setGameAccount(g)
      setGameError(null)
      await refreshFunds().catch(() => undefined)
      // 链上还有未完结的有奖会话：首页弹出恢复
      if (current()) await checkResume()
    } catch (err) {
      if (current()) setGameError(walletErrorText(lang, err))
    }
  }, [refreshFunds, lang, checkResume])

  /** 登录：唤起通行密钥，由系统自己列出该域名下的全部，派生出同一个地址 */
  const login = useCallback(async () => {
    const seq = ++walletSeq.current
    const current = () => walletSeq.current === seq
    setOwnedRareIds(null)
    setCollectionError(null)
    setWalletBusy('login')
    setWalletError(null)
    setGameAccount(null)
    setGameError(null)
    resetFunds()
    try {
      const a = await wallet.login()
      if (!current()) return
      setAccount(a)
      setWalletBusy(null)
      // 余额读不到时留 null：显示「—」，不谎报成 0
      await connectGame(current)
    } catch (err) {
      if (!current()) return
      setWalletError(walletErrorText(lang, err))
    } finally {
      if (current()) setWalletBusy(null)
    }
  }, [lang, resetFunds, connectGame])

  const logout = useCallback(() => {
    // 退出即作废所有在途的钱包操作：注册的领水轮询不能在退出之后再把余额写回来
    walletSeq.current++
    setWalletBusy(null)
    wallet.logout()
    resetPaid()
    paid.dismissResume()
    setAccount(null)
    setGameAccount(null)
    setGameError(null)
    resetFunds()
    setOwnedRareIds(null)
    setCollectionError(null)
    setCollectionBusy(false)
    setWalletOpen(false)
  }, [resetFunds, resetPaid, paid])

  const unlockCollection = useCallback(async () => {
    if (!wallet.getAccount() || collectionBusy) return
    const seq = walletSeq.current
    setCollectionBusy(true)
    setCollectionError(null)
    let key: Uint8Array | null = null
    try {
      const identity = await wallet.openCollectionIdentity()
      key = await wallet.deriveCollectionKey()
      const remote = await readRemoteCollection(identity)
      const ids = remote ? await decryptCollection(remote.envelope, key) : []
      if (walletSeq.current === seq) setOwnedRareIds(ids)
    } catch {
      if (walletSeq.current === seq) {
        setCollectionError(lang === 'zh' ? '图鉴同步失败，请重试。' : 'Collection sync failed. Please try again.')
      }
    } finally {
      key?.fill(0)
      if (walletSeq.current === seq) setCollectionBusy(false)
    }
  }, [collectionBusy, lang])

  /** 钱包面板的「刷新」：sma-b 之前没连上的话顺带重试一次解析 */
  const refreshWallet = useCallback(async () => {
    const seq = walletSeq.current
    const g = await wallet.resolveGameAccount()
    if (walletSeq.current !== seq) return
    setGameAccount(g)
    setGameError(null)
    await refreshFunds()
  }, [refreshFunds])

  const startRace = useCallback((horseId: number, tier: number) => {
    // 有奖场次的唯一接入点：只有 paidEntry 开放（地址、链上代码、游戏账户齐备）时才走链上会话
    if (!isTierPlayable(tier, paidGate.open)) return
    if (tier !== PRACTICE_TIER) {
      if (!gameAccount) return
      const d = paid.start(horseId, tier as 1 | 2 | 3 | 4)
      if (!d) return
      setPaidDriver(d)
      setPaidMeta(null)
      setDriver(d)
      setResult(null)
      setPage('race')
      return
    }
    setPaidDriver(null)
    setPaidMeta(null)
    const seq = raceSeq.current++
    const now = Date.now()
    const d = new RaceDriver({ seed: practiceSeed(qs('seed'), now + seq), playerHorseId: horseId, stakeTier: PRACTICE_TIER })
    d.raceId = practiceRaceId(now, seq)
    setDriver(d)
    setResult(null)
    setPage('race')
  }, [gameAccount, paid, paidGate.open])

  /** 有奖比赛交给结算页：预览名次（待链上验证）+ 后台结算 */
  const showPaidResult = useCallback((d: PaidRaceDriver) => {
    const facts = d.sessionFacts
    const preview = d.preview()
    if (!facts || !preview) return
    const r = paidRaceResult(facts.sessionId, facts.seed, facts.horseId, preview.result)
    setResult(r)
    setPaidMeta({
      stake: facts.stake,
      stakeTier: facts.stakeTier,
      stakeLabel: PAID_STAKE_LABELS[facts.stakeTier] ?? formatMon(facts.stake),
      previewRank: preview.settlementRank,
      notes: paidChoiceNoteKeys(preview.result).map((k) => (k ? t(lang, k) : null)),
    })
    paid.finish()
    go('result')
    audio?.stopBgm()
    audio?.play('audio.sfx_result_open', 0.6)
  }, [audio, go, lang, paid])

  const onRaceDone = useCallback(() => {
    if (paidDriver && driver === paidDriver) {
      showPaidResult(paidDriver)
      return
    }
    if (!(driver instanceof RaceDriver)) return
    // 共享求时器已求出完整结果，尾场演出不参与规则计算。
    const raceId = driver.raceId
    const r = driver.buildResult(raceId)
    setResult(r)
    // 结算页的素材是后台预取的，极端情况下要等一下；等的时候比赛画面留在原地，不闪白
    go('result')
    audio?.stopBgm()
    audio?.play('audio.sfx_result_open', 0.6)
  }, [driver, paidDriver, showPaidResult, audio, go])

  const backHome = useCallback(() => {
    setDriver(null)
    setPaidDriver(null)
    setPaidMeta(null)
    resetPaid()
    setResult(null)
    setPage('home')
    void checkResume()
    audio?.setSlowmo(false)
    void audio?.playBgm('audio.bgm_home', 0.35)
  }, [audio, resetPaid, checkResume])

  /** 恢复链上会话：继续观看（进比赛页）或直接结算（链上时间已越过冲线） */
  const resumePaid = useCallback(async (settleNow: boolean) => {
    const info = paid.resume
    if (!info || resumeBusy) return
    setResumeBusy(true)
    try {
      const d = await paid.resumeRace(info.facts)
      setPaidDriver(d)
      setDriver(d)
      if (settleNow) showPaidResult(d)
      else {
        setResult(null)
        setPage('race')
      }
    } finally {
      setResumeBusy(false)
    }
  }, [paid, resumeBusy, showPaidResult])

  /** 离开有奖比赛页：会话留在链上，首页可恢复 */
  const leavePaidRace = useCallback(() => {
    backHome()
  }, [backHome])

  const quitRace = useCallback(() => {
    // 有奖比赛只会从「入场失败 → 返回」走到这里：链上没有需要终止的东西
    if (paidDriver) {
      audio?.setSlowmo(false)
      backHome()
      return
    }
    setNotice(t(lang, 'race.hidden'))
    setDriver(null)
    setPage('home')
    audio?.setSlowmo(false)
    setTimeout(() => setNotice(null), 4200)
  }, [audio, lang, paidDriver, backHome])

  const paidView: PaidResultView | undefined = useMemo(() => {
    if (!paidMeta || !paid.settle) return undefined
    const s = paid.settle
    return {
      stakeLabel: paidMeta.stakeLabel,
      stake: paidMeta.stake,
      previewRank: paidMeta.previewRank,
      phase: s.phase,
      txHash: s.txHash,
      detail: s.detail,
      settlement: s.settlement ? { rank: s.settlement.rank, payout: s.settlement.payout } : null,
      mismatch: s.mismatch,
      deadline: s.deadline,
      choiceNotes: paidMeta.notes,
      onRetry: paid.retry,
    }
  }, [paidMeta, paid.settle, paid.retry])

  /** 有奖结算后，名次与三次选择以 SessionSettled 为准（结算页与分享图同一份） */
  const shownResult = useMemo(() => {
    const settled = paidMeta ? paid.settle?.settlement : null
    if (!result || !settled) return result
    return { ...result, rank: settled.rank as typeof result.rank, choices: settledChoices(result.choices, settled.acquired) }
  }, [result, paidMeta, paid.settle])

  const stageStyle = useMemo(
    () => ({
      width: canvasWidth,
      height: canvasHeight,
      transform: `scale(${stage.scale})`,
      left: stage.left,
      top: stage.top,
      // 模态窗口在顶层渲染、不受这里的 scale 影响，靠这组变量贴回舞台（theme.css .stage-dialog）
      '--stage-width': `${canvasWidth}px`,
      '--stage-height': `${canvasHeight}px`,
      '--stage-scale': String(stage.scale),
      '--stage-left': `${stage.left}px`,
      '--stage-top': `${stage.top}px`,
    }) as CSSProperties,
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
            gameAccount={gameAccount}
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
            onOpenEffects={import.meta.env.DEV ? () => go('effectShowcase') : undefined}
          />
        )}
        {import.meta.env.DEV && page === 'effectShowcase' && audio && (
          <EffectShowcaseScreen
            lang={lang}
            reducedMotion={settings.reducedMotion}
            audio={audio}
            urls={urls}
            onBack={() => setPage('home')}
          />
        )}
        {page === 'select' && (
          <SelectScreen
            lang={lang}
            balance={walletBalance}
            paidOpen={paidGate.open}
            paidHint={paidGate.hint && t(lang, paidGate.hint)}
            onBack={() => setPage('home')}
            onRace={startRace}
          />
        )}
        {page === 'race' && driver && audio && (
          <RaceScreen
            driver={driver}
            paid={paidDriver && paidDriver === driver ? {
              overlay: () => paidDriver.overlay,
              onLeave: leavePaidRace,
            } : undefined}
            lang={lang}
            reducedMotion={settings.reducedMotion}
            audio={audio}
            urls={urls}
            onDone={onRaceDone}
            onQuit={quitRace}
          />
        )}
        {page === 'result' && shownResult && (
          <ResultScreen
            lang={lang}
            result={shownResult}
            paid={paidMeta ? paidView : undefined}
            choiceNotes={driver instanceof RaceDriver ? paidChoiceNoteKeys(driver.canonicalResult()).map((k) => k ? t(lang, k) : null) : undefined}
            onAgain={() => {
              setDriver(null)
              setPaidDriver(null)
              setPaidMeta(null)
              resetPaid()
              setResult(null)
              go('select')
            }}
            onHome={backHome}
          />
        )}
        {page === 'collection' && <CollectionScreen
          lang={lang}
          onBack={() => setPage('home')}
          signedIn={account !== null}
          ownedRareIds={ownedRareIds}
          loading={collectionBusy}
          error={collectionError}
          onUnlock={() => { void unlockCollection() }}
        />}
        {page === 'settings' && (
          <SettingsScreen
            lang={lang}
            settings={settings}
            onChange={setSettings}
            onBack={() => setPage('home')}
          />
        )}

        {page === 'home' && paid.resume && account && (
          <PaidResumeModal
            lang={lang}
            stakeLabel={PAID_STAKE_LABELS[paid.resume.facts.stakeTier] ?? formatMon(paid.resume.facts.stake)}
            deadline={paid.resume.deadline}
            busy={resumeBusy}
            canSettle={paid.resume.canSettle}
            onContinue={() => void resumePaid(false)}
            onSettle={() => void resumePaid(true)}
            onLater={paid.dismissResume}
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
            gameAccount={gameAccount}
            gameError={gameError}
            funds={funds.funds}
            rootBalance={funds.rootBalance}
            tx={funds.tx}
            onRefresh={refreshWallet}
            onFaucet={() => wallet.claimFaucet()}
            onExport={() => wallet.exportMnemonic()}
            onMigrate={funds.migrate}
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
