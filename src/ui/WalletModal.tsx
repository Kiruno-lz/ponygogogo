/**
 * 钱包管理面板：游戏账户（sma-b）地址、签名账户（根 EOA）地址、网络、原生 MON 余额，
 * 账户迁入的交易状态、给游戏账户领测试币、把签名账户的余额迁入、导出助记词，以及索引器里的最近战绩
 * （只读、只作展示，未配置索引器时不出现）。
 * 助记词只活在这个组件的局部 state 里：面板一卸载就随组件消失，不写任何持久存储。
 */
import { useCallback, useState } from 'react'
import { formatMon } from '../chain/amount.ts'
import type { FaucetResult } from '../chain/faucet.ts'
import type { FundsSnapshot } from '../chain/funds.ts'
import { ENVIO_GRAPHQL_URL } from '../chain/history.ts'
import { shouldOfferMigration } from '../chain/migration.ts'
import { CHAIN, CURRENCY, explorerTxUrl } from '../chain/network.ts'
import { isTxBusy, type TxState } from '../chain/txStatus.ts'
import type { GameAccount, MigrationOutcome, WalletAccount } from '../chain/wallet.ts'
import { Chip, WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { RecentRaces } from './RecentRaces.tsx'
import { StageDialog } from './StageDialog.tsx'
import { walletErrorText } from './walletError.ts'

type Pending = 'refresh' | 'faucet' | 'export' | null

export function WalletModal({
  lang, account, gameAccount, gameError, funds, rootBalance, tx,
  onRefresh, onFaucet, onExport, onMigrate, onClose,
}: {
  lang: Lang
  /** 根 EOA：签名者，只作次要信息展示 */
  account: WalletAccount
  /** sma-b；null = 还在解析或解析失败 */
  gameAccount: GameAccount | null
  gameError: string | null
  /** null = 还没读到，显示占位符而不是 0 */
  funds: FundsSnapshot | null
  rootBalance: bigint | null
  tx: TxState
  onRefresh: () => Promise<void>
  onFaucet: () => Promise<FaucetResult>
  onExport: () => Promise<string>
  onMigrate: () => Promise<MigrationOutcome | null>
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

  const busy = isTxBusy(tx)

  const migrate = useCallback(() => {
    setMessage(null)
    void onMigrate().then((outcome) => {
      if (outcome?.state === 'skipped') setMessage(t(lang, 'wallet.migrateSkipped'))
    })
  }, [onMigrate, lang])

  const money = (v: bigint | null | undefined) => (v === null || v === undefined ? '—' : `${formatMon(v, 4)} ${CURRENCY}`)

  return (
    <StageDialog label={t(lang, 'wallet.title')} testId="wallet-modal" onDismiss={onClose}>
      <div className="panel wallet-modal">
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
            <small>{t(lang, 'wallet.gameAccountHint')}</small>
          </dd>

          <dt className="wallet-secondary">{t(lang, 'wallet.signer')}</dt>
          <dd className="wallet-secondary">
            <span className="mono wallet-signer-address" data-testid="wallet-signer-address">{account.address}</span>
            <small>{t(lang, 'wallet.signerHint')}</small>
          </dd>

          <dt>{t(lang, 'wallet.balance')}</dt>
          <dd>
            <strong className="mono" data-testid="wallet-balance">{money(funds?.wallet)}</strong>
            <Chip label={t(lang, pending === 'refresh' ? 'wallet.refreshing' : 'wallet.refresh')}
              onClick={refresh} disabled={pending !== null} />
          </dd>

        </dl>

        <TxLine lang={lang} tx={tx} />

        {shouldOfferMigration(rootBalance) && gameAccount && (
          <div className="wallet-migrate" data-testid="wallet-migrate">
            <strong>{t(lang, 'wallet.migrateTitle', { amount: formatMon(rootBalance ?? 0n, 4) })}</strong>
            <p>{t(lang, 'wallet.migrateHint')}</p>
            <Chip label={t(lang, busy && tx.phase !== 'idle' && tx.kind === 'migrate' ? 'wallet.migrating' : 'wallet.migrate')}
              onClick={migrate} disabled={busy} />
          </div>
        )}

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

        <WoodButton zh={t(lang, 'wallet.close')} onClick={onClose} style={{ minWidth: 260 }} />
      </div>
    </StageDialog>
  )
}

/** 一行交易进度：已提交 → 已入块 / 失败 / 未确认，有哈希就给浏览器链接。 */
function TxLine({ lang, tx }: { lang: Lang; tx: TxState }) {
  if (tx.phase === 'idle') return null
  const kind = t(lang, `wallet.tx.${tx.kind}`)
  const text = tx.phase === 'failed'
    ? t(lang, 'wallet.tx.failed', { kind, reason: tx.reason === 'reverted' ? t(lang, 'wallet.tx.reverted') : tx.reason })
    : t(lang, `wallet.tx.${tx.phase}`, { kind })
  const hash = tx.phase === 'signing' ? null : tx.hash
  const href = hash ? explorerTxUrl(hash) : null
  return (
    <p className={`wallet-tx${tx.phase === 'failed' ? ' failed' : ''}`} data-testid="wallet-tx" data-phase={tx.phase} role="status">
      <span>{text}</span>
      {href && <a data-testid="wallet-tx-link" href={href} target="_blank" rel="noreferrer noopener">
        {t(lang, 'wallet.tx.view')} <span className="mono">{hash!.slice(0, 10)}…</span>
      </a>}
    </p>
  )
}
