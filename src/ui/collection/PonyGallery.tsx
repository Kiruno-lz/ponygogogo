import { PONY_CATALOG } from '../../game/ponyCatalog.ts'
import { ponyAbilityText } from '../shared/ponyAbilityText.ts'
import { t, type Lang } from '../i18n.ts'

export function PonyGallery({ lang, ownedPonyIds }: { lang: Lang; ownedPonyIds: readonly number[] | null }) {
  return <div className="pony-gallery">
    {PONY_CATALOG.map(pony => {
      const owned = pony.defaultOpen || !!ownedPonyIds?.includes(pony.ponyId)
      const ability = ponyAbilityText(pony.ponyId, lang)
      const state = owned ? (t(lang, 'pony.collected'))
          : ownedPonyIds === null ? (t(lang, 'pony.progressUnknown')) : (t(lang, 'pony.locked'))
      return <article key={pony.ponyId} data-pony={pony.ponyId} data-owned={owned}
        className={`pony-gallery-card${owned ? '' : ' pony-locked'}`}>
        <div className="pony-gallery-header">
          <h2 className="h-title">{lang === 'zh' ? pony.name : pony.nameEn}</h2>
          {!pony.defaultOpen && <span>{owned ? '' : '🔒 '}{state}</span>}
        </div>
        <img className="pony-gallery-image" src={`/assets/art/ponies/${pony.ponyId}-idle-0.webp`}
          alt={lang === 'zh' ? pony.name : pony.nameEn} loading="lazy" draggable={false}/>
        {ability.name && <h3>{ability.name}</h3>}<p>{ability.description}</p>
        {!pony.defaultOpen && <small>{t(lang, 'pony.obtainHint')}</small>}
      </article>
    })}
  </div>
}
