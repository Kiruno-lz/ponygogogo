import { queryParameter as qs } from './app/query.ts'
import { EMPTY_PROGRESS,useAssets } from './app/useAssets.ts'
import { useWalletSession } from './ui/wallet/useWalletSession.ts'
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
import { useCallback,useEffect,useMemo,useRef,useState,type CSSProperties } from 'react'
import { type LoadProgress } from './assets/loader.ts'
import { type AssetTier } from './assets/source.ts'
import { formatMon } from './chain/amount.ts'
import { DEFAULT_PASSKEY_NAME,PONY_GAME_ADDRESS,PONY_VAULT_ADDRESS } from './chain/network.ts'
import {
PRACTICE_TIER,isTierPlayable,paidContractsDeployed,
paidEntry,paidRaceAvailable,
paidRulesCompatible,
type PaidDeployment,
} from './chain/paidGate.ts'
import { PAID_STAKE_LABELS } from './chain/paidStakes.ts'
import { wallet } from './chain/wallet.ts'
import { DESIGN_H,DESIGN_W } from './game/layout.ts'
import { normalizeRoster } from './game/ponyCatalog.ts'
import { practiceForcedSeed,practiceRaceId,practiceSeed } from './practice.ts'
import type { RaceResult } from './race/core/types.ts'
import { RaceDriver } from './race/driver.ts'
import type { PaidRaceDriver } from './race/paidDriver.ts'
import { paidChoiceNoteKeys,paidRaceResult,settledChoices } from './race/paidResult.ts'
import type { RaceScreenDriver } from './race/raceView.ts'
import { ResultScreen,type PaidResultView } from './result/ResultScreen.tsx'
import { CollectionScreen } from './ui/collection/CollectionScreen.tsx'
import { CollectionSyncNotice } from './ui/collection/CollectionSyncNotice.tsx'
import { useCollectionProgress } from './ui/collection/useCollectionProgress.ts'
import { HomeScreen } from './ui/home/HomeScreen.tsx'
import { localized,t } from './ui/i18n.ts'
import { TransientNotice } from './ui/shared/TransientNotice.tsx'
import { LoadingScreen } from './ui/loading/LoadingScreen.tsx'
import { TierGate } from './ui/loading/TierGate.tsx'
import { PaidResumeModal } from './ui/race/PaidResumeModal.tsx'
import { RaceScreen } from './ui/race/RaceScreen.tsx'
import { usePaidRace } from './ui/race/usePaidRace.ts'
import { SelectScreen } from './ui/select/SelectScreen.tsx'
import { SettingsScreen } from './ui/settings/SettingsScreen.tsx'
import { loadSettings,saveSettings,type GameSettings } from './ui/settings/settings.ts'
import { useStage } from './ui/shared/useStage.ts'
import { EffectShowcaseScreen } from './ui/showcase/EffectShowcaseScreen.tsx'
import { RegisterModal } from './ui/wallet/RegisterModal.tsx'
import { WalletModal } from './ui/wallet/WalletModal.tsx'
import { useGameFunds } from './ui/wallet/useGameFunds.ts'

type Page = 'loading' | 'home' | 'select' | 'race' | 'result' | 'collection' | 'effectShowcase'


/** 每个页面进去之前必须就绪的那一级 */
const PAGE_TIER: Partial<Record<Page, AssetTier>> = {
  select: 'race',
  effectShowcase: 'race',
  collection: 'race',
  result: 'result',
}


export default function App() {
  // 惰性初始化：不能先渲染默认值再用 effect 覆盖，否则挂载时的保存会把已存设置冲掉
  const [settings, setSettings] = useState<GameSettings>(loadSettings)
  const [page, setPage] = useState<Page>('loading')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { progress, ready, urls, loaderRef, audioRef, runBlockingLoad, syncUrls } = useAssets(page === 'home')
  // 首页与结算页各自对齐自己那张原画的画布，不跟赛道共用一个尺寸
  const canvasWidth = page === 'home' ? 1611 : page === 'result' ? 1620 : DESIGN_W
  const canvasHeight = page === 'home' ? 976 : page === 'result' ? 971 : DESIGN_H
  const stage = useStage(canvasWidth, canvasHeight)
  /** 根 EOA：只代表「已登录」，界面不再拿它当游戏账户 */
  /** 游戏账户（sma-b）；解析失败时为 null，错误在 gameError */
  const [driver, setDriver] = useState<RaceScreenDriver | null>(null)
  /** 当前这场是有奖比赛时的驱动器（与 driver 同一个对象） */
  const [paidDriver, setPaidDriver] = useState<PaidRaceDriver | null>(null)
  /** 有奖结算页里与链上无关的那部分：下注、预览名次、检查点说明 */
  const [paidMeta, setPaidMeta] = useState<{ stake: bigint; stakeTier: number; stakeLabel: string; previewRank: number; notes: (string | null)[] } | null>(null)
  const [resumeBusy, setResumeBusy] = useState(false)
  /** 有奖合约的链上确认：进选马页时读，读到结论后不再读；读失败保持 checking，下次进选马页再读 */
  const [paidDeployment, setPaidDeployment] = useState<PaidDeployment>('checking')
  const [result, setResult] = useState<RaceResult | null>(null)
  const [notice, setNotice] = useState<ReturnType<typeof localized> | null>(null)
  /**
   * 已就绪资源的 url 表。每完成一级就整体替换一次：RaceScreen 只在挂载时读一次它，
   * 而它进race 页之前已经等过 race 级，所以拿到的一定是全的。
   */
  /** 点得比后台预取快、或者预取失败了：正在等哪一级、要去哪一页 */
  const [gate, setGate] = useState<{ tier: AssetTier; to: Page; failed: boolean; retry?: () => void; cancel?: () => void } | null>(null)
  const [gateProgress, setGateProgress] = useState<LoadProgress>(EMPTY_PROGRESS)
  /** 清单本身取不到时重新走一遍启动流程 */

  /**
   * 钱包操作的世代号。注册的领水轮询要跑十几秒，期间玩家可以退出、甚至再注册一把；
   * 这个号用来判断一次异步返回是不是仍然属于「当前这一次」，过期的一律丢掉，
   * 免得旧的余额或提示覆盖掉新账户。
   */
  /** 本地试玩的局序号，只用于 seed 熵与本地局号 */
  const raceSeq = useRef(0)
  const navigationSeq = useRef(0)

  const lang = settings.lang
  const funds = useGameFunds()
  const { reset: resetFunds, refresh: refreshFunds } = funds
  const paid = usePaidRace(lang, refreshFunds)
  const { account, gameAccount, gameError, walletBusy, walletError, walletErrorKey, walletOpen, registerOpen, walletSeq,
    setWalletOpen, setRegisterOpen, register, login, logout, refreshWallet, setWalletError } = useWalletSession(lang, {
    resetFunds, refreshFunds, setNotice, checkResume: paid.checkResume,
    resetCollection: () => collection.reset(),
    onLogout: () => { raceSeq.current++; navigationSeq.current++; setGate(null); paid.reset(); paid.dismissResume() },
  })
  const collection = useCollectionProgress(lang, gameAccount?.address ?? null)
  const syncedGrants = useRef(new Set<string>())
  const confirmedGrant = paid.settle?.phase === 'settled' ? paid.settle.settlement?.grant : null
  useEffect(() => {
    if (!confirmedGrant || gameAccount?.address.toLowerCase() !== confirmedGrant.player.toLowerCase()) return
    const key = `${confirmedGrant.player.toLowerCase()}:${confirmedGrant.sessionId.toLowerCase()}`
    if (syncedGrants.current.has(key)) return
    syncedGrants.current.add(key)
    collection.acceptGrant(confirmedGrant)
  }, [confirmedGrant, gameAccount?.address, collection.acceptGrant])
  useEffect(() => {
    if (paid.settle?.phase === 'forfeited') void collection.refresh()
  }, [paid.settle?.phase, collection.refresh])
  const { checkResume, reset: resetPaid } = paid
  /** 木牌与选马页显示的「钱包余额」就是 sma-b 的原生 MON；null = 还没读到 */
  const walletBalance = funds.funds?.wallet ?? null
  const paidGate = paidEntry(paidRaceAvailable, paidDeployment, gameAccount !== null)

  useEffect(() => {
    if (page !== 'select' || !paidRaceAvailable || paidDeployment !== 'checking') return
    paidContractsDeployed(wallet.publicClient, PONY_VAULT_ADDRESS!, PONY_GAME_ADDRESS!)
      .then(async ok => !ok ? 'missing' : await paidRulesCompatible(wallet.publicClient, PONY_GAME_ADDRESS!) ? 'deployed' : 'unsupported')
      .then(state => setPaidDeployment(state))
      .catch(() => undefined)
  }, [page, paidDeployment])

  useEffect(() => {
    saveSettings(settings)
    audioRef.current?.setSettings(settings)
  }, [settings])

  /**
   * 带就绪保证的跳转。正常情况下预取早跑完了，isTierReady 直接放行，一帧都不耽误；
   * 没跑完就挂上遮罩等同一个在途 promise，失败了给重试入口，底下那一页照常显示。
   */
  const go = useCallback(
    (to: Page) => {
      const seq = ++navigationSeq.current
      const current = () => navigationSeq.current === seq
      const tier = PAGE_TIER[to]
      const loader = loaderRef.current
      if (!tier || !loader || loader.isTierReady(tier)) {
        setPage(to)
        return
      }
      const cancel = () => { if (current()) navigationSeq.current++ }
      const load = () => {
        if (!current()) return
        setGate({ tier, to, failed: false, retry: load, cancel })
        void loader.loadGroup([tier], progress => { if (current()) setGateProgress(progress) }).then(ok => {
          if (!current()) return
          syncUrls()
          if (ok) {
            setGate(null)
            setPage(to)
          } else {
            setGate({ tier, to, failed: true, retry: load, cancel })
          }
        })
      }
      load()
    },
    [syncUrls],
  )

  const audio = audioRef.current

  const enterGame = useCallback(() => {
    void audio?.unlock().then(() => audio.playBgm('audio.bgm_home', 0.35))
    setPage('home')
  }, [audio])

  const startRace = useCallback((horseId: number, tier: number, roster?: readonly number[]) => {
    // 有奖场次的唯一接入点：只有 paidEntry 开放（地址、链上代码、游戏账户齐备）时才走链上会话
    if (!isTierPlayable(tier, paidGate.open)) return
    const loader = loaderRef.current
    if (!loader) return
    navigationSeq.current++
    const selectedRoster = normalizeRoster(roster)
    const keys = selectedRoster.flatMap(pony => ['idle','running'].map(action => `art.ponies.${pony}-${action}`))
    const seq = ++raceSeq.current
    const walletGeneration = walletSeq.current
    const current = () => raceSeq.current === seq && walletSeq.current === walletGeneration
    // Confirm the five participant images before creating a driver or sending paid entry.
    const launch = () => {
      if (!current()) return
      setGate(null)
      if (tier !== PRACTICE_TIER) {
        if (!gameAccount) return
        const d = paid.start(horseId, tier as 1 | 2 | 3 | 4, selectedRoster)
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
      const now = Date.now()
      const d = new RaceDriver({ seed: practiceSeed(qs('seed'), now + seq), playerHorseId: horseId, stakeTier: PRACTICE_TIER, roster: selectedRoster })
      d.raceId = practiceRaceId(now, seq)
      setDriver(d)
      setResult(null)
      setPage('race')
    }
    if (keys.every(key => loader.url(key))) { launch(); return }
    const cancel = () => { if (current()) raceSeq.current++ }
    const load = () => {
      if (!current()) return
      setGate({ tier: 'race', to: 'race', failed: false, retry: load, cancel })
      void loader.loadKeys(keys, progress => { if (current()) setGateProgress(progress) }).then(ok => {
        if (!current()) return
        syncUrls()
        if (ok) launch()
        else setGate({ tier: 'race', to: 'race', failed: true, retry: load, cancel })
      })
    }
    load()
  }, [gameAccount, paid, paidGate.open, syncUrls])

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
    navigationSeq.current++
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
      const d = await paid.resumeRace(info)
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
    setNotice(localized('race.hidden'))
    setDriver(null)
    setPage('home')
    audio?.setSlowmo(false)
  }, [audio, paidDriver, backHome])

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
      grant: s.phase === 'settled' ? s.settlement?.grant ?? null : null,
      grantError: s.settlement?.grantError ?? null,
      onRetryGrant: paid.retryGrant,
      mismatch: s.mismatch,
      deadline: s.deadline,
      choiceNotes: paidMeta.notes,
      onRetry: paid.retry,
    }
  }, [paidMeta, paid.settle, paid.retry, paid.retryGrant])

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
            ownedRareIds={collection.ownedRareIds}
            busy={walletBusy}
            error={walletError}
            errorKey={walletErrorKey}
            onDismissError={() => setWalletError(null)}
            onStart={() => go('select')}
            onCollection={() => go('collection')}
            onSettings={() => setSettingsOpen(true)}
            onRegister={() => {
              setWalletError(null)
              setRegisterOpen(true)
            }}
            onLogin={() => void login()}
            onOpenWallet={() => setWalletOpen(true)}
            onLogout={logout}
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
            key={account?.address ?? 'guest'}
            lang={lang}
            reducedMotion={settings.reducedMotion}
            availablePonyIds={collection.availablePonyIds}
            rngSeed={practiceForcedSeed(qs('seed')) ?? undefined}
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
            reducedMotion={settings.reducedMotion}
            result={shownResult}
            paid={paidMeta ? paidView : undefined}
            collectionSync={paidMeta ? { loading: collection.loading, error: collection.error, onRetry: collection.unlock } : undefined}
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
          ownedRareIds={collection.ownedRareIds}
          ownedPonyIds={collection.progress?.unlockedPonyIds ?? null}
          loading={collection.loading}
          error={collection.error}
          onUnlock={() => { void collection.refresh() }}
        />}
        {settingsOpen && (
          <SettingsScreen
            lang={lang}
            settings={settings}
            onChange={setSettings}
            onBack={() => setSettingsOpen(false)}
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
            gameAccount={gameAccount}
            gameError={gameError}
            funds={funds.funds}
            onRefresh={refreshWallet}
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
            onRetry={() => gate.retry ? gate.retry() : go(gate.to)}
            onCancel={() => {
              // 比赛已经跑完了，退回去只能回首页；从首页点进来的关掉就是留在首页
              setGate(null)
              gate.cancel?.()
              if (gate.to === 'result') backHome()
            }}
          />
        )}

        {!notice && page !== 'collection' && collection.error && <CollectionSyncNotice
          error={collection.error} loading={collection.loading} onRetry={collection.unlock} lang={lang}/>}
        {(notice || (!collection.error && page === 'home' && paid.resumeError)) && (
          <TransientNotice noticeKey={notice ?? paid.resumeError}
            onDismiss={notice ? () => setNotice(null) : paid.dismissResumeError}
            role={paid.resumeError ? 'alert' : 'status'}>
            {notice?.[lang] ?? t(lang, 'resume.readFailed', { reason: paid.resumeError ?? '' })}
            {!notice && !collection.error && paid.resumeError && <button type="button" className="chip" onClick={() => void checkResume()}>
              {t(lang, 'resume.retry')}
            </button>}
          </TransientNotice>
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
