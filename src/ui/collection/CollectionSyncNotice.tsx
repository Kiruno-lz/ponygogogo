import { t, type Lang } from '../i18n.ts'
import { TransientNotice } from '../shared/TransientNotice.tsx'

export function CollectionSyncNotice({ error, loading, onRetry, lang }: {
  error: string; loading: boolean; onRetry: () => void; lang: Lang
}) {
  return <TransientNotice role="alert" className="panel collection-sync-notice">
    {error}
    <button type="button" className="chip" disabled={loading} onClick={onRetry}>{t(lang, 'grant.retrySync')}</button>
  </TransientNotice>
}
