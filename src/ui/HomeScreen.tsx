/** 首页木牌与标志使用目标图原始切片，按钮保留原有输入处理。 */
import { CURRENCY } from '../chain/network.ts'
import { formatMon } from '../chain/port.ts'
import type { WalletAccount } from '../chain/wallet.ts'
import { CARD_POOL } from '../race/cards/pool.ts'
import { Chip, usePress } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

/** 注册与登录是两条不同的通行密钥流程，按钮各自独立，忙碌时只禁用自己那一条 */
export type WalletBusy = 'register' | 'login' | null

export function HomeScreen({ lang, account, balance, busy, error, onStart, onCollection, onSettings,
  onRegister, onLogin, onOpenWallet, onLogout, onToggleLang }: {
  lang: Lang; account: WalletAccount | null; balance: bigint | null; busy: WalletBusy; error: string | null
  onStart: () => void; onCollection: () => void; onSettings: () => void
  onRegister: () => void; onLogin: () => void; onOpenWallet: () => void; onLogout: () => void
  onToggleLang: () => void
}) {
  return <div className="screen home-screen" data-testid="screen-home">
    <div className="home-artboard">
      <img className="home-logo" src="/assets/art/home/logo.png" alt={t(lang, 'app.title')} draggable={false} />
      <ArtButton art="start" label={t(lang, 'home.start')} en="START" lang={lang} onClick={onStart} />
      <ArtButton art="collection" label={t(lang, 'home.collection')} en="COLLECTION" lang={lang} onClick={onCollection} />
      <ArtButton art="settings" label={t(lang, 'home.settings')} en="SETTINGS" lang={lang} onClick={onSettings} />
      {account ? <div className="home-wallet" data-testid="wallet-panel">
        <button type="button" className="btn wallet-content" data-testid="wallet-open"
          aria-label={t(lang, 'wallet.title')} onClick={onOpenWallet}>
          <div className="wallet-row"><img src="/assets/art/ui/avatar-trimmed.png" alt=""/><span className="mono" data-testid="wallet-label">{account.label}</span></div>
          <div className="wallet-row"><img src="/assets/art/ui/coin-trimmed.png" alt=""/><span className="mono" data-testid="balance">{balance === null ? '—' : `${formatMon(balance)} ${CURRENCY}`}</span></div>
          <div className="wallet-row"><img src="/assets/placeholder/icons/icon_13.png" alt=""/><span>0 / {CARD_POOL.length}</span></div>
        </button>
        <button className="wallet-logout btn" data-testid="wallet-logout" onClick={onLogout} aria-label={t(lang, 'home.logout')} title={t(lang, 'home.logout')}>{t(lang, 'home.logout')}</button>
      </div> : <>
        <ArtButton art="login" label={busy === 'login' ? t(lang, 'home.loggingIn') : t(lang, 'home.login')} en="LOGIN" lang={lang} onClick={onLogin} disabled={busy !== null}/>
        <ArtButton art="register" label={busy === 'register' ? t(lang, 'home.registering') : t(lang, 'home.register')} en="REGISTER" lang={lang} onClick={onRegister} disabled={busy !== null}/>
      </>}
      {error && <p className="home-wallet-error" data-testid="wallet-error" role="alert">{error}</p>}
      <Chip label={lang === 'zh' ? 'EN' : '中文'} onClick={onToggleLang} style={{ position: 'absolute', right: 38, bottom: 30, fontSize: 15, padding: '5px 12px' }}/>
    </div>
  </div>
}

function ArtButton({ art, label, en, lang, onClick, disabled }: {
  art: string; label: string; en: string; lang: Lang; onClick: () => void; disabled?: boolean
}) {
  const { pressed, handlers } = usePress(onClick, disabled)
  return <button type="button" className={`btn home-${art}${pressed ? ' pressed' : ''}`} aria-label={`${label} ${en}`} disabled={disabled} {...handlers}>
    <img src={`/assets/art/home/${art}${lang === 'en' ? '-en' : ''}.png`} alt="" draggable={false}/>
  </button>
}
