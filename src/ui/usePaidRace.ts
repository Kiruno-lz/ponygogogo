/**
 * 有奖比赛的页面级编排：开场交易 → 驱动器 → 选牌交易 → 冲线后自动结算 → 结算页；登录后的会话恢复。
 *
 * 链上读写全部经 chain/paidSession.ts，规则与画面全部在 race/paidDriver.ts；这里只管顺序、世代号与
 * 界面状态。每场比赛一个链上时钟（chainClock），比赛与结算期间每 1.5 s 读一次链头校准。
 * 结算在「链上时间下界 ≥ 冲线 wall 向上取整到秒 + 300 ms」后才发：合约以
 * (block.timestamp − T0)·1000 ≥ finishWall 放行，早发只会得到 RaceNotFinished；只有这一种失败自动再试两次，
 * 赞助额度用完等被拒的结算绝不自动重发，交给「重试结算」。
 *
 * 会话协议 v2 没有退款：所需锚过窗后会话被判负、返还 0（结算页印章「已判负」）。冲线后结算页与恢复窗口
 * 显示结算期限（chain/settleDeadline.ts），逾期视为放弃。
 */
import { useCallback, useRef, useState } from 'react'
import type { Hex } from 'viem'
import { ChainClock, startClockSync, type ClockSync } from '../chain/chainClock.ts'
import { PONY_GAME_ADDRESS } from '../chain/network.ts'
import { paidRaceAvailable } from '../chain/paidGate.ts'
import {
  choosePaidCard, openPaidSession, PaidSessionError, readSessionFacts, readSettleDeadline, recoverPaidSession,
  settlePaidSession, type PaidChainDeps, type PaidSessionFacts, type PaidSettlementFacts,
} from '../chain/paidSession.ts'
import { PAID_STAKE_WEI } from '../chain/paidStakes.ts'
import { wallet } from '../chain/wallet.ts'
import { PaidRaceDriver } from '../race/paidDriver.ts'
import { compareSettlement, solveFromFacts } from '../race/paidResult.ts'
import { ALCHEMY_TIMING, DEV_EOA_TIMING, settleReadyWall } from '../race/paidWindow.ts'
import type { PaidSettlePhase } from '../result/ResultScreen.tsx'
import { t, type Lang } from './i18n.ts'
import { deadlineView, paidErrorText, paidReasonText, type DeadlineView } from './paidText.ts'

export type PaidSettleState = {
  phase: PaidSettlePhase
  txHash: Hex | null
  detail: string | null
  settlement: PaidSettlementFacts | null
  mismatch: boolean
  /** 结算期限；读不到或所需锚都已封存为 null */
  deadline: DeadlineView
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 待恢复的会话、链上时间是否已越过玩家冲线（可以直接结算），以及结算期限 */
export type PaidResumeInfo = { facts: PaidSessionFacts; canSettle: boolean; deadline: DeadlineView }

async function deadlineOf(sessionId: Hex): Promise<DeadlineView> {
  return deadlineView(await readSettleDeadline(wallet.publicClient, PONY_GAME_ADDRESS!, sessionId), Date.now())
}

async function resumeInfo(facts: PaidSessionFacts): Promise<PaidResumeInfo> {
  const deadline = await deadlineOf(facts.sessionId)
  try {
    const head = await wallet.publicClient.getBlock({ blockTag: 'latest' })
    const finishWall = solveFromFacts(facts).finishWall[facts.horseId]!
    return { facts, canSettle: (Number(head.timestamp) - facts.openedAt) * 1000 >= Number(finishWall), deadline }
  } catch {
    return { facts, canSettle: false, deadline }
  }
}

export function usePaidRace(lang: Lang, refreshFunds: () => Promise<void>) {
  const [settle, setSettle] = useState<PaidSettleState | null>(null)
  const [resume, setResume] = useState<PaidResumeInfo | null>(null)
  const driverRef = useRef<PaidRaceDriver | null>(null)
  const clockRef = useRef<ChainClock | null>(null)
  const syncRef = useRef<ClockSync | null>(null)
  const gen = useRef(0)

  const stopSync = useCallback(() => {
    syncRef.current?.stop()
    syncRef.current = null
  }, [])

  const freshClock = useCallback((): ChainClock => {
    stopSync()
    const clock = new ChainClock({ headLagMs: 1000 })
    clockRef.current = clock
    syncRef.current = startClockSync(wallet.publicClient, clock, { intervalMs: 1500 })
    return clock
  }, [stopSync])

  const deps = useCallback((timeoutMs: number): PaidChainDeps => {
    const account = wallet.getCallAccount()
    if (!account || !PONY_GAME_ADDRESS) throw new PaidSessionError('account-not-resolved')
    return {
      account, client: wallet.publicClient, game: PONY_GAME_ADDRESS,
      poll: { pollMs: 400, timeoutMs }, clock: clockRef.current ?? undefined, now: () => performance.now(),
    }
  }, [])

  const makeDriver = useCallback((horseId: number, tier: 1 | 2 | 3 | 4, clock: ChainClock): PaidRaceDriver => {
    const driver: PaidRaceDriver = new PaidRaceDriver({
      playerHorseId: horseId,
      stakeTier: tier,
      clock,
      timing: wallet.onDevChain ? DEV_EOA_TIMING : ALCHEMY_TIMING,
      // 选牌等满一个窗口加入块余量就够了：之后即使上链也在窗口外，合约必然拒绝
      submitChoice: (k, cardId, slots, onStep) => choosePaidCard(deps(30_000), driver.sessionFacts!, k, cardId, slots, onStep),
    })
    driverRef.current = driver
    return driver
  }, [deps])

  /** 开一场有奖比赛：立刻返回驱动器（倒计时与入场状态由比赛页显示），开场交易在后台跑。 */
  const start = useCallback((horseId: number, tier: 1 | 2 | 3 | 4): PaidRaceDriver | null => {
    if (!paidRaceAvailable) return null
    const g = ++gen.current
    setSettle(null)
    const clock = freshClock()
    const driver = makeDriver(horseId, tier, clock)
    void (async () => {
      try {
        const { facts } = await openPaidSession(deps(90_000), horseId, PAID_STAKE_WEI[tier], (step) => {
          if (gen.current === g) driver.setEntryStep(step)
        })
        if (gen.current !== g) return
        await syncRef.current?.sampleOnce()
        driver.open(facts)
      } catch (err) {
        if (gen.current !== g) return
        driver.failEntry(paidErrorText(lang, err))
        if (err instanceof PaidSessionError && err.code === 'active-session' && err.sessionId) {
          const facts = await readSessionFacts(wallet.publicClient, PONY_GAME_ADDRESS!, err.sessionId).catch(() => null)
          if (facts && gen.current === g) setResume(await resumeInfo(facts))
        }
      }
    })()
    return driver
  }, [deps, freshClock, lang, makeDriver])

  /** 刷新恢复：按链上事实建驱动器，跳过倒计时，直接落到当前规范时刻。 */
  const resumeRace = useCallback(async (facts: PaidSessionFacts): Promise<PaidRaceDriver> => {
    ++gen.current
    setSettle(null)
    setResume(null)
    const clock = freshClock()
    await syncRef.current?.sampleOnce()
    const driver = makeDriver(facts.horseId, facts.stakeTier, clock)
    driver.setEntryStep({ phase: 'included', hash: null })
    driver.open(facts, { resume: true })
    return driver
  }, [freshClock, makeDriver])

  const runSettlement = useCallback(async (driver: PaidRaceDriver, g: number) => {
    const live = () => gen.current === g
    const facts0 = driver.sessionFacts
    const clock = clockRef.current
    const finishWall = driver.playerFinishWall
    if (!facts0 || !clock || finishWall === null) return
    // 重试时保留已知的期限，不让那一行闪掉
    setSettle((s) => ({ phase: 'waiting', txHash: null, detail: null, settlement: null, mismatch: false, deadline: s?.deadline ?? null }))
    // 期限只是提示：后台读，读到就补上，不拖慢结算
    const refreshDeadline = () => void deadlineOf(facts0.sessionId).then((deadline) => {
      if (live()) setSettle((s) => s && s.phase !== 'settled' && s.phase !== 'forfeited' ? { ...s, deadline } : s)
    })
    refreshDeadline()
    const ready = settleReadyWall(finishWall)
    for (;;) {
      const lo = clock.estimate(performance.now()).lo - facts0.openedAt * 1000
      if (lo >= ready) break
      await sleep(Math.min(500, Math.max(50, ready - lo)))
      if (!live()) return
    }
    for (let attempt = 0; ; attempt++) {
      // 先按链上最新事实校正预览（未确认的选择、恢复进场）
      const fresh = await readSessionFacts(wallet.publicClient, PONY_GAME_ADDRESS!, facts0.sessionId).catch(() => null)
      if (!live()) return
      if (fresh && fresh.state === 1) driver.reconcile(fresh)
      let hash: Hex | null = null
      const out = await settlePaidSession(deps(90_000), facts0, (step) => {
        if (!live()) return
        if (step.phase === 'submitted') setSettle((s) => s && { ...s, phase: 'pending', detail: null })
        if (step.phase === 'included' && step.hash) hash = step.hash
      }).catch((err: unknown) => ({ state: 'failed' as const, reason: paidErrorText(lang, err), hash: null }))
      if (!live()) return
      if (out.state === 'settled') {
        const canonical = driver.canonicalResult()
        const check = canonical ? compareSettlement(out.settlement, canonical) : { rank: true, full: true }
        setSettle({
          phase: 'settled', txHash: out.settlement.hash ?? hash, detail: null, settlement: out.settlement, mismatch: !check.rank,
          deadline: null,
        })
        await refreshFunds().catch(() => undefined)
        return
      }
      if (out.state === 'failed' && out.reason === 'FORFEITED') {
        // 判负是终局：返还 0，下注已转入庄家流动性
        setSettle({ phase: 'forfeited', txHash: null, detail: null, settlement: null, mismatch: false, deadline: null })
        await refreshFunds().catch(() => undefined)
        return
      }
      const reason = out.state === 'failed' ? out.reason : t(lang, 'result.settleUnknown')
      if (out.state === 'failed' && reason === 'RaceNotFinished' && attempt < 2) {
        await sleep(1500)
        if (!live()) return
        continue
      }
      setSettle((s) => ({
        phase: 'failed', txHash: out.state === 'failed' ? out.hash : null, detail: paidReasonText(lang, reason), settlement: null,
        mismatch: false, deadline: s?.deadline ?? null,
      }))
      refreshDeadline()
      return
    }
  }, [deps, lang, refreshFunds])

  /** 玩家冲线、比赛页交回结算页时调用：返回驱动器，后台开始结算。 */
  const finish = useCallback((): PaidRaceDriver | null => {
    const driver = driverRef.current
    if (!driver?.sessionFacts) return null
    void runSettlement(driver, gen.current)
    return driver
  }, [runSettlement])

  const retry = useCallback(() => {
    const driver = driverRef.current
    if (driver) void runSettlement(driver, gen.current)
  }, [runSettlement])

  /** 登录/解析出游戏账户后调用：链上有未完结会话就提示恢复。 */
  const checkResume = useCallback(async () => {
    if (!paidRaceAvailable || !PONY_GAME_ADDRESS) return
    const player = wallet.getGameAccount()?.address
    if (!player) return
    const facts = await recoverPaidSession(wallet.publicClient, PONY_GAME_ADDRESS, player).catch(() => null)
    setResume(facts ? await resumeInfo(facts) : null)
  }, [])

  const reset = useCallback(() => {
    ++gen.current
    stopSync()
    driverRef.current = null
    setSettle(null)
  }, [stopSync])

  return {
    settle, resume, start, resumeRace, finish, retry, checkResume, reset,
    dismissResume: useCallback(() => setResume(null), []),
    get driver() { return driverRef.current },
  }
}
