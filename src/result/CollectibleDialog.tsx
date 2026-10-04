import type { CollectibleGrant } from '../chain/rewards.ts'
import { Card } from '../cards/Card.tsx'
import { StageDialog } from '../ui/StageDialog.tsx'
import { t, type Lang } from '../ui/i18n.ts'
import { collectibleView } from './collectibleView.ts'

export type CollectionSyncView = { loading: boolean; error: string | null; onRetry: () => void }

export function CollectibleDialog({ grant, lang, sync, onClose }: {
  grant: CollectibleGrant; lang: Lang; sync?: CollectionSyncView; onClose: () => void
}) {
  const view = collectibleView(grant, lang)
  return <StageDialog label={view.title} testId="collectible-dialog" className="collectible-dialog" onDismiss={onClose}>
    <div className="collectible-panel" data-asset-kind={grant.assetKind} data-asset-id={grant.assetId}>
      <button type="button" autoFocus className="collectible-close" aria-label={t(lang, 'grant.close')} onClick={onClose}>×</button>
      <h2>{view.title}</h2><span className="collectible-kind">{view.kind}</span>
      <div className="collectible-art">{view.card ? <Card def={view.card} lang={lang} size="gallery"/>
        : <img src={view.image} alt={view.name} draggable={false}/>}</div>
      <h3>{view.name}</h3><p>{view.collected}</p>
      {sync?.loading && <p role="status">{t(lang, 'grant.syncing')}</p>}
      {sync?.error && <div role="alert" className="collectible-sync-error"><p>{sync.error}</p>
        <button type="button" className="chip" disabled={sync.loading} onClick={sync.onRetry}>{t(lang, 'grant.retrySync')}</button></div>}
    </div>
  </StageDialog>
}
