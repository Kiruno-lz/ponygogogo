/**
 * 钱包面板背后的资金状态：sma-b 钱包余额与 Vault 可用余额的同块快照、根账户余额、
 * 以及当前这一笔资金交易的进度。状态放在 App 一级，面板关掉再打开，在途交易的进度还在。
 *
 * 每次登录、注册、退出都 `reset()`：世代号自增，旧账户在途的读数与交易回报一律丢弃，
 * 不会写到新账户的界面上。
 */
import { useCallback, useReducer, useRef, useState } from 'react'
import type { FundsSnapshot } from '../chain/funds.ts'
import { TX_IDLE, isTxBusy, txReducer, type TxKind, type TxState } from '../chain/txStatus.ts'
import { wallet, type MigrationOutcome } from '../chain/wallet.ts'
import type { Lang } from './i18n.ts'
import { walletErrorText } from './walletError.ts'

export type GameFunds = {
  funds: FundsSnapshot | null
  rootBalance: bigint | null
  tx: TxState
  reset: () => void
  /** 读失败时把快照清回 null（界面显示占位符而不是旧数字），并把错误抛给调用方展示 */
  refresh: () => Promise<void>
  deposit: (amount: bigint) => Promise<void>
  withdraw: (amount: bigint) => Promise<void>
  migrate: () => Promise<MigrationOutcome | null>
}

export function useGameFunds(lang: Lang): GameFunds {
  const [funds, setFunds] = useState<FundsSnapshot | null>(null)
  const [rootBalance, setRootBalance] = useState<bigint | null>(null)
  const [tx, rawDispatch] = useReducer(txReducer, TX_IDLE)
  const gen = useRef(0)
  const txRef = useRef<TxState>(TX_IDLE)
  const fundsRef = useRef<FundsSnapshot | null>(null)

  /** 同步维护一份 ref：同一事件循环里连点两次，第二次也能看到「已在途」 */
  const dispatch = useCallback((e: Parameters<typeof txReducer>[1]) => {
    txRef.current = txReducer(txRef.current, e)
    rawDispatch(e)
  }, [])

  const reset = useCallback(() => {
    gen.current++
    fundsRef.current = null
    setFunds(null)
    setRootBalance(null)
    dispatch({ type: 'reset' })
  }, [dispatch])

  const refresh = useCallback(async () => {
    const g = gen.current
    try {
      const [next, root] = await Promise.all([wallet.readFunds(), wallet.readRootBalance().catch(() => null)])
      if (gen.current !== g) return
      fundsRef.current = next
      setFunds(next)
      setRootBalance(root)
    } catch (err) {
      if (gen.current === g) {
        fundsRef.current = null
        setFunds(null)
      }
      throw err
    }
  }, [])

  const runCall = useCallback(async (kind: TxKind, submit: (f: FundsSnapshot) => Promise<string>) => {
    const snapshot = fundsRef.current
    if (!snapshot || isTxBusy(txRef.current)) return
    const g = gen.current
    const live = () => gen.current === g
    dispatch({ type: 'start', kind })
    try {
      const callId = await submit(snapshot)
      if (!live()) return
      dispatch({ type: 'submitted', callId })
      const result = await wallet.trackCall(callId, (p) => { if (live()) dispatch({ type: 'progress', progress: p }) })
      if (!live()) return
      dispatch(result.state === 'timeout' ? { type: 'timeout' } : { type: 'progress', progress: result })
    } catch (err) {
      if (live()) dispatch({ type: 'error', reason: walletErrorText(lang, err) })
    } finally {
      if (live()) await refresh().catch(() => undefined)
    }
  }, [dispatch, lang, refresh])

  const deposit = useCallback((amount: bigint) => runCall('deposit', (f) => wallet.deposit(f, amount)), [runCall])
  const withdraw = useCallback((amount: bigint) => runCall('withdraw', (f) => wallet.withdraw(f, amount)), [runCall])

  const migrate = useCallback(async (): Promise<MigrationOutcome | null> => {
    if (isTxBusy(txRef.current)) return null
    const g = gen.current
    const live = () => gen.current === g
    dispatch({ type: 'start', kind: 'migrate' })
    try {
      const outcome = await wallet.migrateRootFunds()
      if (!live()) return null
      if (outcome.state === 'skipped') {
        dispatch({ type: 'reset' })
        return outcome
      }
      dispatch({ type: 'submitted', hash: outcome.hash })
      const receipt = await wallet.trackTransaction(outcome.hash)
      if (!live()) return null
      dispatch(receipt.state === 'timeout' ? { type: 'timeout' } : { type: 'receipt', status: receipt.state, hash: receipt.hash })
      return outcome
    } catch (err) {
      if (live()) dispatch({ type: 'error', reason: walletErrorText(lang, err) })
      return null
    } finally {
      if (live()) await refresh().catch(() => undefined)
    }
  }, [dispatch, lang, refresh])

  return { funds, rootBalance, tx, reset, refresh, deposit, withdraw, migrate }
}
