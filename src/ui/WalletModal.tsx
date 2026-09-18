/**
 * 钱包管理面板：地址、链上余额、领测试币、导出助记词、退出。
 * 助记词只活在这个组件的局部 state 里：面板一卸载就随组件消失，不写任何持久存储。
 */
import { useCallback, useEffect, useState } from 'react'
import type { FaucetResult } from '../chain/faucet.ts'
import { CHAIN, CURRENCY } from '../chain/network.ts'
import { formatMon } from '../chain/port.ts'
import type { WalletAccount } from '../chain/wallet.ts'
import { Chip, WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { walletErrorText } from './walletError.ts'

type Pending = 'refresh' | 'faucet' | 'export' | null

export function WalletModal({
  lang, account, balance, gameBalance, onRefresh, onFaucet, onExport, onClose,
}: {
  lang: Lang
  account: WalletAccount
  /** null = 还没读到链上余额，显示占位符而不是 0 */
  balance: bigint | null
  gameBalance: bigint
  onRefresh: () => Promise<void>
  onFaucet: () => Promise<FaucetResult>
  onExport: () => Promise<string>
  onClose: () => void
}) {
  const [pending, setPending] = useState<Pending>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyAddress = useCallback(() => {
    // 非安全上下文或老浏览器里没有 clipboard，writeText 取不到就直接放弃，不要往 undefined 上挂 then
    const written = navigator.clipboard?.writeText(account.address)
    if (!written) return
    void written.then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }, () => undefined)
  }, [account.address])

  const refresh = useCallback(() => {
    setPending('refresh')
    setMessage(null)
    void onRefresh()
      .catch((e: unknown) => setMessage(walletErrorText(lang, e)))
      .finally(() => setPending(null))
  }, [onRefresh, lang])

  const faucet = useCallback(() => {
    setPending('faucet')
    setMessage(null)
    void onFaucet()
      .then((r) => {
        setMessage(r.ok ? t(lang, 'wallet.faucetSlow') : t(lang, 'wallet.faucetFailed', { detail: r.detail }))
        return onRefresh().catch(() => undefined)
      })
      .finally(() => setPending(null))
  }, [onFaucet, onRefresh, lang])

  const exportMnemonic = useCallback(() => {
    setPending('export')
    setMessage(null)
    void onExport()
      .then((words) => setMnemonic(words))
      .catch((e: unknown) => setMessage(walletErrorText(lang, e)))
      .finally(() => setPending(null))
  }, [onExport, lang])

  return (
    <div className="wallet-modal-host" data-testid="wallet-modal" role="dialog" aria-modal="true"
      aria-label={t(lang, 'wallet.title')}>
      <div className="wallet-modal-scrim" onClick={onClose} />
      <div className="panel wallet-modal">
        <h2 className="h-title">{t(lang, 'wallet.title')}</h2>

        <dl className="wallet-facts">
          <dt>{t(lang, 'wallet.network')}</dt>
          <dd>{CHAIN.name}</dd>

          <dt>{t(lang, 'wallet.address')}</dt>
          <dd>
            <span className="mono wallet-full-address" data-testid="wallet-address">{account.address}</span>
            <Chip label={t(lang, copied ? 'wallet.copied' : 'wallet.copy')} onClick={copyAddress} />
          </dd>

          <dt>{t(lang, 'wallet.balance')}</dt>
          <dd>
            <strong className="mono" data-testid="wallet-balance">{balance === null ? '—' : `${formatMon(balance, 4)} ${CURRENCY}`}</strong>
            <Chip label={t(lang, pending === 'refresh' ? 'wallet.refreshing' : 'wallet.refresh')}
              onClick={refresh} disabled={pending !== null} />
          </dd>

          <dt>{t(lang, 'wallet.gameBalance')}</dt>
          <dd>
            <span className="mono" data-testid="wallet-game-balance">{formatMon(gameBalance)} {CURRENCY}</span>
            <small>{t(lang, 'wallet.gameBalanceHint')}</small>
          </dd>
        </dl>

        {message && <p className="wallet-message" data-testid="wallet-message">{message}</p>}

        {mnemonic ? (
          <div className="wallet-mnemonic" data-testid="wallet-mnemonic">
            <p className="wallet-warn">{t(lang, 'wallet.exportWarn')}</p>
            <ol>
              {mnemonic.split(' ').map((w, i) => (
                <li key={`${i}-${w}`}><span className="mono">{w}</span></li>
              ))}
            </ol>
            <Chip label={t(lang, 'wallet.exportDone')} onClick={() => setMnemonic(null)} />
          </div>
        ) : null}

        <div className="wallet-actions">
          <Chip label={t(lang, pending === 'faucet' ? 'wallet.faucetPending' : 'wallet.faucet')}
            onClick={faucet} disabled={pending !== null} />
          <Chip label={t(lang, pending === 'export' ? 'wallet.exporting' : 'wallet.export')}
            onClick={exportMnemonic} disabled={pending !== null} />
        </div>

        <WoodButton zh={t(lang, 'wallet.close')} onClick={onClose} style={{ minWidth: 260 }} />
      </div>
    </div>
  )
}
