import { PAID_CARD_POOL } from '../race/cards/paidCards.ts'
import { useLayoutEffect, useRef, useState } from 'react'
import { Card } from '../cards/Card.tsx'
import { WoodButton, Chip } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { PONY_CATALOG } from '../game/ponyCatalog.ts'
import { PonyGallery } from './PonyGallery.tsx'

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
  const [page, setPage] = useState<'cards' | 'ponies'>('cards')
  const cardScroll = useRef<HTMLDivElement>(null), ponyScroll = useRef<HTMLDivElement>(null)
  const savedScroll = useRef({ cards: 0, ponies: 0 })
  useLayoutEffect(() => {
    const element = page === 'cards' ? cardScroll.current : ponyScroll.current
    if (element) element.scrollTop = savedScroll.current[page]
  }, [page])
  const list = PAID_CARD_POOL.filter((c) => filter === 'all' || c.quality === filter)
  return (
    <div
      className="screen"
      data-testid="screen-collection"
      style={{ background: 'linear-gradient(#f7efe4,#e6d3bd)', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '18px 30px' }}>
        <WoodButton
          zh={t(lang, 'collection.back')}
          onClick={onBack}
          style={{ minWidth: 200, minHeight: 74 }}
        />
        <h1 className="h-title" style={{ margin: 0, fontSize: 38 }}>
          {lang === 'zh' ? '图鉴' : 'Collection'}
        </h1>
        <span style={{ fontSize: 20, opacity: 0.75 }}>
          {page === 'cards' ? t(lang, 'collection.count', { n: list.length })
            : `${PONY_CATALOG.filter(p => p.defaultOpen || ownedPonyIds?.includes(p.ponyId)).length} / ${PONY_CATALOG.length}`}
        </span>
        {signedIn && <WoodButton
          zh={lang === 'zh' ? (loading ? '读取中…' : '读取收藏') : (loading ? 'Loading…' : 'Read collection')}
          onClick={onUnlock}
          style={{ minWidth: 140, minHeight: 56 }}
        />}
        <div style={{ display: page === 'cards' ? 'flex' : 'none', gap: 10, marginLeft: 'auto' }}>
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
      <div className="collection-tabs" role="tablist" aria-label={lang === 'zh' ? '图鉴类别' : 'Collection category'}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const next = page === 'cards' ? 'ponies' : 'cards'
          setPage(next)
          event.currentTarget.querySelector<HTMLButtonElement>(`[id="collection-tab-${next}"]`)?.focus()
        }}>
        {(['cards', 'ponies'] as const).map(value => <button key={value} type="button" role="tab" id={`collection-tab-${value}`}
          aria-controls={`collection-panel-${value}`} aria-selected={page === value} tabIndex={page === value ? 0 : -1}
          onClick={() => setPage(value)}>{value === 'cards' ? (lang === 'zh' ? '卡牌' : 'Cards') : (lang === 'zh' ? '小马' : 'Ponies')}</button>)}
      </div>
      {error && <div role="alert" style={{ padding: '0 34px 12px', color: '#8b2525' }}>{error}</div>}
      <div
        ref={cardScroll}
        role="tabpanel" id="collection-panel-cards" aria-labelledby="collection-tab-cards" hidden={page !== 'cards'}
        onScroll={event => { if (page === 'cards') savedScroll.current.cards = event.currentTarget.scrollTop }}
        className="scrolly"
        style={{
          flex: 1,
          display: page === 'cards' ? 'flex' : 'none',
          flexWrap: 'wrap',
          gap: 22,
          padding: '0 34px 34px',
          alignContent: 'flex-start',
        }}
      >
        {list.map((def) => (
          <div key={def.cardId} style={{ width: 290 }}>
            {def.quality === 'rare' && !ownedRareIds?.includes(def.cardId)
              ? <div data-card={def.cardId} style={{ width: 290, height: 390, display: 'grid', placeItems: 'center', background: '#bea887', border: '5px solid #6e4b2f', borderRadius: 12 }}>
                  {lang === 'zh' ? '稀有卡尚未收藏' : 'Rare card locked'}
                </div>
              : <Card def={def} lang={lang} size="gallery" />}
            {(def.quality !== 'rare' || ownedRareIds?.includes(def.cardId)) && <div style={{ fontSize: 14, opacity: 0.72, marginTop: 4, lineHeight: 1.4 }}>
              <div>
                <strong>{t(lang, 'collection.meme')}:</strong> {def.meme}
              </div>
              <div>{t(lang, def.cpuUsable ? 'collection.cpu' : 'collection.cpuNo')}</div>
            </div>}
          </div>
        ))}
      </div>
      <div ref={ponyScroll} className="scrolly" role="tabpanel" id="collection-panel-ponies" aria-labelledby="collection-tab-ponies"
        hidden={page !== 'ponies'} style={{ flex: 1, minHeight: 0, display: page === 'ponies' ? 'block' : 'none' }}
        onScroll={event => { if (page === 'ponies') savedScroll.current.ponies = event.currentTarget.scrollTop }}>
        <PonyGallery lang={lang} ownedPonyIds={ownedPonyIds}/>
      </div>
    </div>
  )
}
