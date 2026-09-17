import { WoodButton, Chip } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import type { GameSettings } from './settings.ts'

export function SettingsScreen({
  lang,
  settings,
  onChange,
  onBack,
}: {
  lang: Lang
  settings: GameSettings
  onChange: (s: GameSettings) => void
  onBack: () => void
}) {
  const row = (
    key: 'master' | 'bgm' | 'sfx',
    label: string,
  ): React.ReactElement => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24 }}>
      <span style={{ width: 150 }}>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(settings[key] * 100)}
        data-testid={`vol-${key}`}
        onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) / 100 })}
        style={{ width: 380, accentColor: '#f4a22a' }}
      />
      <span className="mono" style={{ width: 54, textAlign: 'right' }}>
        {Math.round(settings[key] * 100)}
      </span>
    </div>
  )

  return (
    <div
      className="screen"
      data-testid="screen-settings"
      style={{
        background: 'linear-gradient(#f7efe4,#e6d3bd)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
      }}
    >
      <h1 className="h-title" style={{ fontSize: 42, margin: 0 }}>
        {t(lang, 'settings.title')}
      </h1>
      <div className="panel" style={{ width: 900, padding: '14px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {row('master', t(lang, 'settings.master'))}
        {row('bgm', t(lang, 'settings.bgm'))}
        {row('sfx', t(lang, 'settings.sfx'))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24 }}>
          <span style={{ width: 150 }}>{t(lang, 'settings.language')}</span>
          <Chip label="中文" on={settings.lang === 'zh'} onClick={() => onChange({ ...settings, lang: 'zh' })} />
          <Chip label="English" on={settings.lang === 'en'} onClick={() => onChange({ ...settings, lang: 'en' })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24 }}>
          <span style={{ width: 150 }}>{t(lang, 'settings.reducedMotion')}</span>
          <Chip
            label={t(lang, settings.reducedMotion ? 'settings.on' : 'settings.off')}
            on={settings.reducedMotion}
            onClick={() => onChange({ ...settings, reducedMotion: !settings.reducedMotion })}
          />
          <Chip
            label={lang === 'zh' ? (settings.muted ? '静音' : '声音') : (settings.muted ? 'MUTED' : 'SOUND')}
            on={!settings.muted}
            onClick={() => onChange({ ...settings, muted: !settings.muted })}
          />
        </div>
      </div>
      <WoodButton zh={t(lang, 'settings.back')} onClick={onBack} style={{ minWidth: 300 }} />
    </div>
  )
}
