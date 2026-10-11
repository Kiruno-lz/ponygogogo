import { PAID_CARD_POOL } from '../../race/cards/paidCards.ts'
import { useLayoutEffect, useRef, useState } from 'react'
import { Card } from '../../cards/Card.tsx'
import { WoodButton, Chip } from '../shared/Button.tsx'
import { t, type Lang } from '../i18n.ts'
import { PonyGallery } from './PonyGallery.tsx'
import { CollectionTabs, type CollectionPage } from './CollectionTabs.tsx'

type Props = {
  lang: Lang
  onBack: () => void
  signedIn?: boolean
  ownedRareIds?: readonly string[] | null
  ownedPonyIds?: readonly number[] | null
  loading?: boolean
  error?: string | null
  onUnlock?: () => void
}

export function CollectionScreen({ lang, onBack, signedIn = false, ownedRareIds = null, ownedPonyIds = null, loading = false, error, onUnlock }: Props) {
  const [filter, setFilter] = useState<'all' | 'common' | 'rare'>('all')
  const [page, setPage] = useState<CollectionPage>('cards')
  const cardScroll = useRef<HTMLDivElement>(null), ponyScroll = useRef<HTMLDivElement>(null)
  const savedScroll = useRef({ cards: 0, ponies: 0 })
  useLayoutEffect(() => {
    const element = page === 'cards' ? cardScroll.current : ponyScroll.current
    if (element) element.scrollTop = savedScroll.current[page]
  }, [page])
  const list = PAID_CARD_POOL.filter((c) => filter === 'all' || c.quality === filter)
  return (
    <div
      className="screen collection-screen"
      data-testid="screen-collection"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <header className="collection-header">
        <div className="collection-heading">
          <WoodButton
            zh={t(lang, 'collection.back')}
            onClick={onBack}
            style={{ minWidth: 200, minHeight: 74 }}
          />
          {signedIn && <WoodButton
            zh={t(lang, loading ? 'collection.loading' : 'collection.unlock')}
            onClick={onUnlock}
            style={{ minWidth: 140, minHeight: 56 }}
          />}
        </div>
        <CollectionTabs lang={lang} page={page} onChange={setPage} />
        <div className="collection-tools">
          <div style={{ display: page === 'cards' ? 'flex' : 'none', gap: 10 }}>
            {(['all', 'common', 'rare'] as const).map((f) => (
              <Chip
                key={f}
                label={f === 'all' ? 'ALL' : t(lang, f === 'rare' ? 'card.rare' : 'card.common')}
                on={filter === f}
                onClick={() => setFilter(f)}
                style={{ fontSize: 18 }}
              />
            ))}
          </div>
        </div>
      </header>
      {error && <div role="alert" style={{ padding: '0 84px 12px', color: '#8b2525' }}>{error}</div>}
      <div
        ref={cardScroll}
        role="tabpanel" id="collection-panel-cards" aria-labelledby="collection-tab-cards" hidden={page !== 'cards'}
        onScroll={event => { if (page === 'cards') savedScroll.current.cards = event.currentTarget.scrollTop }}
        className="scrolly collection-panel collection-card-grid"
        style={{ display: page === 'cards' ? 'flex' : 'none' }}
      >
        {list.map((def) => (
          <div key={def.cardId} className="collection-card-slot">
            {def.quality === 'rare' && !ownedRareIds?.includes(def.cardId)
              ? <div data-card={def.cardId} style={{ width: 290, height: 390, display: 'grid', placeItems: 'center', background: '#bea887', border: '5px solid #6e4b2f', borderRadius: 12 }}>
                  {t(lang, 'collection.locked')}
                </div>
              : <Card def={def} lang={lang} size="gallery"
                  style={def.quality === 'rare' ? { height: 'calc(390px + 16px / var(--collection-card-scale))', top: -16 } : undefined} />}
          </div>
        ))}
      </div>
      <div ref={ponyScroll} className="scrolly collection-panel" role="tabpanel" id="collection-panel-ponies" aria-labelledby="collection-tab-ponies"
        hidden={page !== 'ponies'} style={{ display: page === 'ponies' ? 'block' : 'none' }}
        onScroll={event => { if (page === 'ponies') savedScroll.current.ponies = event.currentTarget.scrollTop }}>
        <PonyGallery lang={lang} ownedPonyIds={ownedPonyIds}/>
      </div>
    </div>
  )
}
