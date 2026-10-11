/**
 * 钱包管理面板：游戏账户（sma-b）地址、网络、原生 MON 余额，
 * 账户迁入的交易状态、给游戏账户领测试币、把签名账户的余额迁入、导出助记词，以及索引器里的最近战绩
 * （只读、只作展示，未配置索引器时不出现）。
 * 助记词只活在这个组件的局部 state 里：面板一卸载就随组件消失，不写任何持久存储。
 */
import { useCallback,useState } from 'react'
import { formatMon } from '../../chain/amount.ts'
import type { FaucetResult } from '../../chain/faucet.ts'
import type { FundsSnapshot } from '../../chain/funds.ts'
import { ENVIO_GRAPHQL_URL } from '../../chain/history.ts'
import { CHAIN,CURRENCY } from '../../chain/network.ts'
import type { GameAccount } from '../../chain/wallet.ts'
import { t,type Lang } from '../i18n.ts'
import { Chip } from '../shared/Button.tsx'
import { StageDialog } from '../shared/StageDialog.tsx'
import { RecentRaces } from './RecentRaces.tsx'
import { walletErrorText } from './walletError.ts'

type Pending = 'refresh' | 'faucet' | 'export' | null

export function WalletModal({
  lang, gameAccount, gameError, funds,
  onRefresh, onFaucet, onExport, onClose,
}: {
  lang: Lang
  /** sma-b；null = 还在解析或解析失败 */
  gameAccount: GameAccount | null
  gameError: string | null
  /** null = 还没读到，显示占位符而不是 0 */
  funds: FundsSnapshot | null
  onRefresh: () => Promise<void>
  onFaucet: () => Promise<FaucetResult>
  onExport: () => Promise<string>
  onClose: () => void
}) {
  const [pending, setPending] = useState<Pending>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyAddress = useCallback(() => {
    if (!gameAccount) return
    // 非安全上下文或老浏览器里没有 clipboard，writeText 取不到就直接放弃，不要往 undefined 上挂 then
    const written = navigator.clipboard?.writeText(gameAccount.address)
    if (!written) return
    void written.then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }, () => undefined)
  }, [gameAccount])

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
      .catch((e: unknown) => setMessage(walletErrorText(lang, e)))
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

  const money = (v: bigint | null | undefined) => (v === null || v === undefined ? '—' : `${formatMon(v, 4)} ${CURRENCY}`)

  return (
    <StageDialog label={t(lang, 'wallet.title')} testId="wallet-modal" onDismiss={onClose}>
      <div className="panel stage-modal-panel wallet-modal">
        <h2 className="h-title">{t(lang, 'wallet.title')}</h2>

        <dl className="wallet-facts">
          <dt>{t(lang, 'wallet.network')}</dt>
          <dd data-testid="wallet-network">{CHAIN.name}</dd>

          <dt>{t(lang, 'wallet.gameAccount')}</dt>
          <dd>
            {gameAccount ? <>
              <span className="mono wallet-full-address" data-testid="wallet-address">{gameAccount.address}</span>
              <Chip label={t(lang, copied ? 'wallet.copied' : 'wallet.copy')} onClick={copyAddress} />
            </> : <span data-testid="wallet-address-pending">{gameError ?? t(lang, 'wallet.resolving')}</span>}
          </dd>

          <dt>{t(lang, 'wallet.balance')}</dt>
          <dd>
            <strong className="mono" data-testid="wallet-balance">{money(funds?.wallet)}</strong>
            <Chip label={t(lang, pending === 'refresh' ? 'wallet.refreshing' : 'wallet.refresh')}
              onClick={refresh} disabled={pending !== null} />
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

        {ENVIO_GRAPHQL_URL && gameAccount && <RecentRaces lang={lang} player={gameAccount.address} />}

        <div className="wallet-actions">
          <Chip label={t(lang, pending === 'faucet' ? 'wallet.faucetPending' : 'wallet.faucet')}
            onClick={faucet} disabled={pending !== null || !gameAccount} />
          <Chip label={t(lang, pending === 'export' ? 'wallet.exporting' : 'wallet.export')}
            onClick={exportMnemonic} disabled={pending !== null} />
        </div>

      </div>
    </StageDialog>
  )
}
