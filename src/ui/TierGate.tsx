/**
 * 分级就绪的兜底遮罩。后台预取正常跑完的话玩家永远看不到它：
 * 只有「点得比预取快」或者「预取失败了」才会出现。
 *
 * 用词沿用加载页那一套（同样的进度读数、同样的失败清单、同样的重试木牌），
 * 因为这本来就是同一件事——被推迟到导航时刻的加载，不该再学一套新说法。
 * 底下那一页保持原样渲染，所以不会白屏。
 */
import type { LoadProgress } from '../assets/loader.ts'
import { WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

export function TierGate({
  lang,
  progress,
  waiting,
  onRetry,
  onCancel,
}: {
  lang: Lang
  progress: LoadProgress
  /** true=还在等，false=已经失败了 */
  waiting: boolean
  onRetry: () => void
  onCancel: () => void
}) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  return (
    <div className="tier-gate" data-testid="tier-gate">
      <div className="panel" style={{ width: 720, padding: '14px 24px', textAlign: 'center' }}>
        {waiting ? (
          <>
            <strong style={{ fontSize: 22 }}>{t(lang, 'assets.preparing')}…</strong>
            <div className="mono" data-testid="tier-gate-progress" style={{ marginTop: 10, fontSize: 20 }}>
              {progress.done} / {progress.total} · {pct}%
            </div>
          </>
        ) : (
          <div data-testid="tier-gate-error">
            <strong style={{ fontSize: 20 }}>
              {t(lang, 'loading.failed', { n: progress.failures.length })}
            </strong>
            <ul className="scrolly" style={{ maxHeight: 110, margin: '8px 0', paddingLeft: 22, fontSize: 15, textAlign: 'left' }}>
              {progress.failures.slice(0, 12).map((f) => (
                <li key={f.key}>
                  <code>{f.key}</code> — {f.message}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <WoodButton
                zh={t(lang, 'loading.retry')}
                onClick={onRetry}
                style={{ minWidth: 300, minHeight: 84, transform: 'scale(0.8)' }}
              />
              <WoodButton
                zh={t(lang, 'assets.later')}
                variant={2}
                onClick={onCancel}
                style={{ minWidth: 240, minHeight: 84, transform: 'scale(0.8)' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
