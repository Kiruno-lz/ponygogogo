import { useEffect, useRef, useState } from 'react'
import { t, type Lang } from './i18n.ts'

export function CollectionSyncNotice({ error, loading, onRetry, lang }: {
  error: string; loading: boolean; onRetry: () => void; lang: Lang
}) {
  const [visible, setVisible] = useState(true)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5000)
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setVisible(false)
    }
    window.addEventListener('pointerdown', outside)
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', outside) }
  }, [])
  if (!visible) return null
  return <div ref={panel} data-testid="notice" role="alert" className="panel collection-sync-notice">
    {error}
    <button type="button" className="chip" disabled={loading} onClick={onRetry}>{t(lang, 'grant.retrySync')}</button>
  </div>
}
