import type { LoadProgress } from '../assets/loader.ts'
import { t, type Lang } from './i18n.ts'
import { WoodButton } from './Button.tsx'

export function LoadingScreen({
  progress,
  lang,
  onRetry,
  onEnter,
  ready,
}: {
  progress: LoadProgress
  lang: Lang
  onRetry: () => void
  onEnter: () => void
  ready: boolean
}) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  const failed = progress.failures.length > 0
  return (
    <div
      className="screen"
      data-testid="screen-loading"
      style={{
        background: 'linear-gradient(#f7e9d8,#e8cfb4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
      }}
    >
      <img src="/assets/placeholder/ui/logo_title.webp" alt={t(lang, 'app.title')} draggable={false} style={{ width: 700, height: 305, objectFit: 'contain' }}/>
      <p style={{ margin: 0, fontSize: 22, opacity: 0.75 }}>{t(lang, 'loading.title')}</p>

      <div
        style={{
          width: 720,
          height: 34,
          borderRadius: 12,
          background: '#c39a75',
          border: '4px solid #8a5f3f',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="loading-bar"
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(#ffd75e,#f0a326)',
            transition: 'width 140ms linear',
          }}
        />
      </div>
      <div className="mono" data-testid="loading-progress" style={{ fontSize: 20 }}>
        {progress.done} / {progress.total} · {pct}%
      </div>
      <div style={{ fontSize: 16, opacity: 0.7, height: 22 }}>
        {progress.current ? `${t(lang, 'loading.item')} ${progress.current}` : ''}
      </div>

      {failed && (
        <div
          className="panel"
          data-testid="loading-error"
          style={{ width: 720, maxHeight: 220, padding: '8px 20px' }}
        >
          <strong style={{ fontSize: 20 }}>
            {t(lang, 'loading.failed', { n: progress.failures.length })}
          </strong>
          <ul className="scrolly" style={{ maxHeight: 110, margin: '8px 0', paddingLeft: 22, fontSize: 15 }}>
            {progress.failures.slice(0, 12).map((f) => (
              <li key={f.key}>
                <code>{f.key}</code> — {f.message}
              </li>
            ))}
          </ul>
          <WoodButton
            zh={t(lang, 'loading.retry')}
            onClick={onRetry}
            style={{ minWidth: 300, minHeight: 84, transform: 'scale(0.8)' }}
          />
        </div>
      )}

      {ready && !failed && (
        <WoodButton
          zh={t(lang, 'loading.enter')}
          en="ENTER"
          onClick={onEnter}
          style={{ minWidth: 360 }}
        />
      )}
    </div>
  )
}
