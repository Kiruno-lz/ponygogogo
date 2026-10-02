/**
 * 首页。木牌、标志和登录注册牌都是无字的透明原画，摆在 1611×976 画板的原始版位上；
 * 牌面上的文字由这里排版，所以换语言不用换图，也不会有第二套切片要维护。
 */
import { CURRENCY } from '../chain/network.ts'
import { formatMon } from '../chain/amount.ts'
import type { GameAccount, WalletAccount } from '../chain/wallet.ts'
import { PAID_CARD_POOL } from '../race/cards/paidCards.ts'
import { Chip, usePress } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

/** 注册与登录是两条不同的通行密钥流程，按钮各自独立，忙碌时只禁用自己那一条 */
export type WalletBusy = 'register' | 'login' | null

export function HomeScreen({ lang, account, gameAccount, balance, busy, error, onStart, onCollection, onSettings,
  onRegister, onLogin, onOpenWallet, onLogout, onToggleLang, onOpenEffects }: {
  /** 根 EOA 只决定「是否已登录」；木牌上展示的是游戏账户（sma-b）的地址与余额 */
  lang: Lang; account: WalletAccount | null; gameAccount: GameAccount | null
  /** sma-b 的原生 MON 余额；null = 还没读到 */
  balance: bigint | null; busy: WalletBusy; error: string | null
  onStart: () => void; onCollection: () => void; onSettings: () => void
  onRegister: () => void; onLogin: () => void; onOpenWallet: () => void; onLogout: () => void
  onToggleLang: () => void
  /** 仅由 Vite 开发构建传入；生产首页不显示验收入口 */
  onOpenEffects?: () => void
}) {
  // 英文时主副标题会重复，只留主标题
  const sub = (key: 'home.startEn' | 'home.collectionEn' | 'home.settingsEn') =>
    lang === 'zh' ? t(lang, key) : undefined
  return <div className="screen home-screen" data-testid="screen-home">
    <div className="home-artboard">
      <img className="home-bg" src="/assets/art/ui/bg-title.webp" alt="" draggable={false} />
      <img className="home-logo" src="/assets/art/home/logo.webp" alt={t(lang, 'app.title')} draggable={false} />
      <ArtButton art="start" label={t(lang, 'home.start')} sub={sub('home.startEn')} onClick={onStart} />
      <ArtButton art="collection" label={t(lang, 'home.collection')} sub={sub('home.collectionEn')} onClick={onCollection} />
      <ArtButton art="settings" label={t(lang, 'home.settings')} sub={sub('home.settingsEn')} onClick={onSettings} />
      {account ? <div className="home-wallet" data-testid="wallet-panel">
        <button type="button" className="btn wallet-content" data-testid="wallet-open"
          aria-label={t(lang, 'wallet.title')} onClick={onOpenWallet}>
          <div className="wallet-row"><img src="/assets/art/ui/avatar-trimmed.webp" alt=""/><span className="mono" data-testid="wallet-label">{gameAccount?.label ?? '…'}</span></div>
          <div className="wallet-row"><img src="/assets/art/ui/coin-trimmed.webp" alt=""/><span className="mono" data-testid="balance">{balance === null ? '—' : `${formatMon(balance)} ${CURRENCY}`}</span></div>
          <div className="wallet-row"><img src="/assets/placeholder/icons/icon_13.webp" alt=""/><span>0 / {PAID_CARD_POOL.length}</span></div>
        </button>
        <button className="wallet-logout btn" data-testid="wallet-logout" onClick={onLogout} aria-label={t(lang, 'home.logout')} title={t(lang, 'home.logout')}>{t(lang, 'home.logout')}</button>
      </div> : <>
        <ArtButton art="login" label={busy === 'login' ? t(lang, 'home.loggingIn') : t(lang, 'home.login')} onClick={onLogin} disabled={busy !== null}/>
        <ArtButton art="register" label={busy === 'register' ? t(lang, 'home.registering') : t(lang, 'home.register')} onClick={onRegister} disabled={busy !== null}/>
      </>}
      {error && <p className="home-wallet-error" data-testid="wallet-error" role="alert">{error}</p>}
      {onOpenEffects && <Chip label={t(lang, 'home.effectShowcase')} onClick={onOpenEffects}
        style={{ position: 'absolute', left: 38, bottom: 30, fontSize: 15, padding: '5px 12px' }} />}
      <Chip label={lang === 'en' ? '中文' : 'EN'} onClick={onToggleLang} style={{ position: 'absolute', right: 38, bottom: 30, fontSize: 15, padding: '5px 12px' }}/>
    </div>
  </div>
}

function ArtButton({ art, label, sub, onClick, disabled }: {
  art: string; label: string; sub?: string; onClick: () => void; disabled?: boolean
}) {
  const { pressed, handlers } = usePress(onClick, disabled)
  return <button type="button" className={`btn home-${art}${pressed ? ' pressed' : ''}`}
    aria-label={sub ? `${label} ${sub}` : label} disabled={disabled} {...handlers}>
    <img src={`/assets/art/home/${art}.webp`} alt="" draggable={false}/>
    <span className="lbl">
      <span className="zh">{label}</span>
      {sub ? <span className="en">{sub}</span> : null}
    </span>
  </button>
}
