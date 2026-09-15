/** 首页。构图对齐 assrt/tittle.png 与 tittle_logined.png */
import type { AccountInfo } from '../chain/port.ts'
import { formatMon } from '../chain/port.ts'
import { CARD_POOL } from '../race/cards/pool.ts'
import { WoodButton, Chip } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

export function HomeScreen({
  lang,
  account,
  balance,
  connecting,
  onStart,
  onCollection,
  onSettings,
  onConnect,
  onDisconnect,
  onToggleLang,
}: {
  lang: Lang
  account: AccountInfo | null
  balance: bigint
  connecting: boolean
  onStart: () => void
  onCollection: () => void
  onSettings: () => void
  onConnect: () => void
  onDisconnect: () => void
  onToggleLang: () => void
}) {
  return (
    <div
      className="screen"
      data-testid="screen-home"
      style={{ background: 'linear-gradient(#ffffff,#f6efe6)' }}
    >
      {/* logo 已是紧裁的干净素材（不含登录/注册木牌），直接按比例铺开即可 */}
      <img
        src="/assets/placeholder/ui/logo_title.png"
        alt={t(lang, 'app.title')}
        draggable={false}
        style={{ position: 'absolute', left: 150, top: 40, width: 860 }}
      />

      <div
        style={{
          position: 'absolute',
          left: 520,
          top: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <WoodButton
          zh={t(lang, 'home.start')}
          en="START"
          icon="🏁"
          onClick={onStart}
          variant={1}
          style={{ minWidth: 560 }}
        />
        <WoodButton
          zh={t(lang, 'home.collection')}
          en="COLLECTION"
          icon="🃏"
          onClick={onCollection}
          variant={2}
          style={{ minWidth: 500, marginLeft: 30 }}
        />
        <WoodButton
          zh={t(lang, 'home.settings')}
          en="SETTINGS"
          icon="⚙️"
          onClick={onSettings}
          variant={3}
          style={{ minWidth: 500, marginLeft: 30 }}
        />
      </div>

      {/* 右上：mock 钱包入口 */}
      <div style={{ position: 'absolute', right: 56, top: 34, width: 350 }}>
        {account ? (
          <div className="panel" data-testid="wallet-panel" style={{ padding: '2px 14px' }}>
            <Row icon="🐴" text={account.label} />
            <Row icon="🪙" text={`${formatMon(balance)} MON`} testId="balance" />
            <Row icon="🃏" text={`0 / ${CARD_POOL.length}`} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingBottom: 6 }}>
              <Chip label={lang === 'zh' ? 'EN' : '中文'} onClick={onToggleLang} style={{ fontSize: 16, padding: '4px 12px' }} />
              <Chip
                label={t(lang, 'home.logout')}
                onClick={onDisconnect}
                style={{ fontSize: 16, padding: '4px 12px' }}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' }}>
            <WoodButton
              zh={connecting ? t(lang, 'home.connecting') : t(lang, 'home.login')}
              onClick={onConnect}
              disabled={connecting}
              style={{ minWidth: 260, minHeight: 84 }}
            />
            <WoodButton
              zh={t(lang, 'home.register')}
              onClick={onConnect}
              disabled={connecting}
              style={{ minWidth: 260, minHeight: 84 }}
            />
            <Chip label={lang === 'zh' ? 'EN' : '中文'} onClick={onToggleLang} style={{ fontSize: 16 }} />
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ icon, text, testId }: { icon: string; text: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 21, padding: '4px 0' }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span className="mono">{text}</span>
    </div>
  )
}
