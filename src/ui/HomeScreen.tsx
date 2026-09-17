/** 首页木牌与标志使用目标图原始切片，按钮保留原有输入处理。 */
import type { AccountInfo } from '../chain/port.ts'
import { formatMon } from '../chain/port.ts'
import { CARD_POOL } from '../race/cards/pool.ts'
import { Chip, usePress } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

export function HomeScreen({ lang, account, balance, connecting, onStart, onCollection, onSettings,
  onConnect, onDisconnect, onToggleLang }: {
  lang: Lang; account: AccountInfo | null; balance: bigint; connecting: boolean
  onStart: () => void; onCollection: () => void; onSettings: () => void
  onConnect: () => void; onDisconnect: () => void; onToggleLang: () => void
}) {
  return <div className="screen home-screen" data-testid="screen-home">
    <div className="home-artboard">
      <img className="home-logo" src="/assets/art/home/logo.png" alt={t(lang, 'app.title')} draggable={false} />
      <ArtButton art="start" label={t(lang, 'home.start')} en="START" lang={lang} onClick={onStart} />
      <ArtButton art="collection" label={t(lang, 'home.collection')} en="COLLECTION" lang={lang} onClick={onCollection} />
      <ArtButton art="settings" label={t(lang, 'home.settings')} en="SETTINGS" lang={lang} onClick={onSettings} />
      {account ? <div className="home-wallet" data-testid="wallet-panel">
        <div className="wallet-content">
          <div className="wallet-row"><img src="/assets/art/ui/avatar-trimmed.png" alt=""/><span className="mono">{account.label}</span></div>
          <div className="wallet-row"><img src="/assets/art/ui/coin-trimmed.png" alt=""/><span className="mono" data-testid="balance">{formatMon(balance)} MON</span></div>
          <div className="wallet-row"><img src="/assets/placeholder/icons/icon_13.png" alt=""/><span>0 / {CARD_POOL.length}</span></div>
        </div>
        <button className="wallet-logout btn" onClick={onDisconnect} aria-label={t(lang, 'home.logout')} title={t(lang, 'home.logout')}>{t(lang, 'home.logout')}</button>
      </div> : <>
        <ArtButton art="login" label={connecting ? t(lang, 'home.connecting') : t(lang, 'home.login')} en="LOGIN" lang={lang} onClick={onConnect} disabled={connecting}/>
        <ArtButton art="register" label={t(lang, 'home.register')} en="REGISTER" lang={lang} onClick={onConnect} disabled={connecting}/>
      </>}
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
