import { useState } from 'react'
import { CARD_POOL } from '../race/cards/pool.ts'
import { Card } from '../cards/Card.tsx'
import { WoodButton, Chip } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

export function CollectionScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [filter, setFilter] = useState<'all' | 'common' | 'rare'>('all')
  const list = CARD_POOL.filter((c) => filter === 'all' || c.quality === filter)
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
          {t(lang, 'collection.title')}
        </h1>
        <span style={{ fontSize: 20, opacity: 0.75 }}>
          {t(lang, 'collection.count', { n: list.length })}
        </span>
        <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
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
      <div
        className="scrolly"
        style={{
          flex: 1,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 22,
          padding: '0 34px 34px',
          alignContent: 'flex-start',
        }}
      >
        {list.map((def) => (
          <div key={def.cardId} style={{ width: 290 }}>
            <Card def={def} lang={lang} size="gallery" />
            <div style={{ fontSize: 14, opacity: 0.72, marginTop: 4, lineHeight: 1.4 }}>
              <div>
                <strong>{t(lang, 'collection.meme')}:</strong> {def.meme}
              </div>
              <div>{t(lang, def.cpuUsable ? 'collection.cpu' : 'collection.cpuNo')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
