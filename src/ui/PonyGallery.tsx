import { PONY_CATALOG } from '../game/ponyCatalog.ts'
import { ponyAbilityText } from './ponyAbilityText.ts'
import type { Lang } from './i18n.ts'

export function PonyGallery({ lang, ownedPonyIds }: { lang: Lang; ownedPonyIds: readonly number[] | null }) {
  return <div className="pony-gallery">
    {PONY_CATALOG.map(pony => {
      const owned = pony.defaultOpen || !!ownedPonyIds?.includes(pony.ponyId)
      const ability = ponyAbilityText(pony.ponyId, lang)
      const state = pony.defaultOpen ? (lang === 'zh' ? '默认开放' : 'Available by default')
        : owned ? (lang === 'zh' ? '已获得' : 'Collected')
          : ownedPonyIds === null ? (lang === 'zh' ? '进度未读取' : 'Progress not loaded') : (lang === 'zh' ? '未获得' : 'Not collected')
      return <article key={pony.ponyId} data-pony={pony.ponyId} data-owned={owned}
        className={`pony-gallery-card${owned ? '' : ' pony-locked'}`}>
        <div className="pony-gallery-header"><h2>{lang === 'zh' ? pony.name : pony.nameEn}</h2><span>{owned ? '' : '🔒 '}{state}</span></div>
        <img className="pony-gallery-image" src={`/assets/art/ponies/${pony.ponyId}-idle-0.webp`}
          alt={lang === 'zh' ? pony.name : pony.nameEn} loading="lazy" draggable={false}/>
        <h3>{ability.name}</h3><p>{ability.description}</p><p className="pony-strategy">{ability.strategy}</p>
        {!pony.defaultOpen && <small>{lang === 'zh' ? '有奖比赛结算时随机获得' : 'Randomly collected at paid-race settlement'}</small>}
      </article>
    })}
  </div>
}
