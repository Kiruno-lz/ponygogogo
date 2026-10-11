import { t, type Lang } from '../i18n.ts'

export type CollectionPage = 'cards' | 'ponies'

export function CollectionTabs({ lang, page, onChange }: {
  lang: Lang; page: CollectionPage; onChange: (page: CollectionPage) => void
}) {
  return <div className="collection-tabs" data-page={page} role="tablist" aria-label={t(lang, 'collection.categories')}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'cards' : event.key === 'End' ? 'ponies' : page === 'cards' ? 'ponies' : 'cards'
      onChange(next)
      event.currentTarget.querySelector<HTMLButtonElement>(`[id="collection-tab-${next}"]`)?.focus()
    }}>
    <span className="collection-tab-thumb" aria-hidden="true" />
    {(['cards', 'ponies'] as const).map(value => <button key={value} type="button" role="tab" id={`collection-tab-${value}`}
      aria-controls={`collection-panel-${value}`} aria-selected={page === value} tabIndex={page === value ? 0 : -1}
      onClick={() => onChange(value)}>{t(lang, value === 'cards' ? 'collection.cards' : 'collection.ponies')}</button>)}
  </div>
}
