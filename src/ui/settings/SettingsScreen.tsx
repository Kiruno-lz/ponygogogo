import { Chip } from '../shared/Button.tsx'
import { StageDialog } from '../shared/StageDialog.tsx'
import { t, type Lang } from '../i18n.ts'
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
      <span id={`settings-vol-${key}`} style={{ width: 150 }}>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(settings[key] * 100)}
        aria-labelledby={`settings-vol-${key}`}
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
    <StageDialog label={t(lang, 'settings.title')} testId="screen-settings" onDismiss={onBack}>
      <div className="panel stage-modal-panel settings-modal">
        <h2 className="h-title">
          {t(lang, 'settings.title')}
        </h2>
        <div className="settings-controls">
          {row('master', t(lang, 'settings.master'))}
          {row('bgm', t(lang, 'settings.bgm'))}
          {row('sfx', t(lang, 'settings.sfx'))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24 }}>
            <span style={{ width: 150 }}>{t(lang, 'settings.language')}</span>
            <Chip label={t(lang, 'settings.chinese')} on={settings.lang === 'zh'} onClick={() => onChange({ ...settings, lang: 'zh' })} />
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
              label={t(lang, settings.muted ? 'settings.muted' : 'settings.sound')}
              on={!settings.muted}
              onClick={() => onChange({ ...settings, muted: !settings.muted })}
            />
          </div>
        </div>
      </div>
    </StageDialog>
  )
}
