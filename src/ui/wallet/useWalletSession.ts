import { useCallback, useRef, useState } from 'react'
import { wallet, type GameAccount, type WalletAccount } from '../../chain/wallet.ts'
import { localized, type Lang } from '../i18n.ts'
import { walletErrorMessages } from './walletError.ts'
import type { WalletBusy } from './types.ts'

export function useWalletSession(lang: Lang, { resetFunds, refreshFunds, resetCollection, checkResume, onLogout, setNotice }: {
  resetFunds: () => void; refreshFunds: () => Promise<void>; resetCollection: () => void
  checkResume: () => Promise<void>; onLogout: () => void; setNotice: (notice: ReturnType<typeof localized> | null) => void
}) {
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [gameAccount, setGameAccount] = useState<GameAccount | null>(null)
  const [gameError, setGameError] = useState<ReturnType<typeof localized> | null>(null)
  const [walletBusy, setWalletBusy] = useState<WalletBusy>(null)
  const [walletError, setWalletError] = useState<ReturnType<typeof localized> | null>(null)
  const [walletOpen, setWalletOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const walletSeq = useRef(0)
  /** 注册：用取名窗口给定的用户名建通行密钥 → 派生账户 → 自动领一次测试币 */
  const register = useCallback(async (userName: string) => {
    const seq = ++walletSeq.current
    const current = () => walletSeq.current === seq
    resetCollection()
    setWalletBusy('register')
    setWalletError(null)
    setNotice(null)
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
        const text = walletErrorMessages(resolveError)
        setGameError(text)
        setNotice(text)
      } else {
        await refreshFunds().catch(() => undefined)
        if (!current()) return
        // 受理不等于到账：只有余额真涨了才说「已到账」
        setNotice(
          !faucet?.ok
            ? localized('wallet.faucetFailed', { detail: faucet?.detail ?? '' })
            : localized(funded ? 'wallet.faucetOk' : 'wallet.faucetSlow'),
        )
      }
    } catch (err) {
      if (!current()) return
      setWalletError(walletErrorMessages(err))
    } finally {
      if (current()) {
        setWalletBusy(null)
        setRegisterOpen(false)
      }
    }
  }, [resetFunds, refreshFunds, resetCollection, setNotice])

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
      if (current()) setGameError(walletErrorMessages(err))
    }
  }, [refreshFunds, checkResume])

  /** 登录：唤起通行密钥，由系统自己列出该域名下的全部，派生出同一个地址 */
  const login = useCallback(async () => {
    const seq = ++walletSeq.current
    const current = () => walletSeq.current === seq
    resetCollection()
    setWalletBusy('login')
    setWalletError(null)
    setNotice(null)
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
      setWalletError(walletErrorMessages(err))
    } finally {
      if (current()) setWalletBusy(null)
    }
  }, [resetFunds, connectGame, resetCollection, setNotice])

  const logout = useCallback(() => {
    // 退出即作废所有在途的钱包操作：注册的领水轮询不能在退出之后再把余额写回来
    walletSeq.current++
    onLogout()
    setWalletBusy(null)
    setWalletError(null)
    setNotice(null)
    wallet.logout()
    setAccount(null)
    setGameAccount(null)
    setGameError(null)
    resetFunds()
    resetCollection()
    setWalletOpen(false)
  }, [resetFunds, resetCollection, onLogout, setNotice])

  /** 钱包面板的「刷新」：sma-b 之前没连上的话顺带重试一次解析 */
  const refreshWallet = useCallback(async () => {
    const seq = walletSeq.current
    const g = await wallet.resolveGameAccount()
    if (walletSeq.current !== seq) return
    setGameAccount(g)
    setGameError(null)
    await refreshFunds()
  }, [refreshFunds])


  return { account, gameAccount, gameError: gameError?.[lang] ?? null, walletBusy, walletError: walletError?.[lang] ?? null,
    walletErrorKey: walletError, walletOpen, registerOpen, walletSeq, setWalletOpen, setRegisterOpen, register, login, logout, refreshWallet, setWalletError }
}
