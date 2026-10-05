import { useMemo, useState } from 'react'
import { zeroAddress } from 'viem'
import type { AudioManager } from '../assets/audio.ts'
import type { CollectibleGrant } from '../chain/rewards.ts'
import { EFFECT_SHOWCASE_SCENARIOS, EffectShowcaseDriver, type ShowcaseEntry } from '../game/effectShowcase.ts'
import { PONY_CATALOG } from '../game/ponyCatalog.ts'
import { PAID_CARD_POOL, paidCardDef } from '../race/cards/paidCards.ts'
import { CollectibleDialog } from '../result/CollectibleDialog.tsx'
import { RaceScreen } from './RaceScreen.tsx'
import { SelectScreen } from './SelectScreen.tsx'
import { t, type Lang } from './i18n.ts'

const ALL_PONIES = PONY_CATALOG.map(pony => pony.ponyId)
const GRANT_PONIES = PONY_CATALOG.filter(pony => !pony.defaultOpen)
const RARE_CARDS = PAID_CARD_POOL.filter(card => card.quality === 'rare')
const keepCatalogOrder = () => .999

export function EffectShowcaseScreen({ lang, reducedMotion, audio, urls, onBack }: {
  lang: Lang; reducedMotion: boolean; audio: AudioManager; urls: Record<string, string>; onBack: () => void
}) {
  const [scenario, setScenario] = useState('C-02')
  const [entry, setEntry] = useState<ShowcaseEntry | null>(null)
  const [replay, setReplay] = useState(0)
  const [paused, setPaused] = useState(false)
  const [forceReduced, setForceReduced] = useState(false)
  const [windDirection, setWindDirection] = useState<1 | -1>(1)
  const [grantPony, setGrantPony] = useState(GRANT_PONIES[0]!.ponyId)
  const [grantCard, setGrantCard] = useState(RARE_CARDS[0]!.cardId)
  const [grant, setGrant] = useState<CollectibleGrant | null>(null)
  const driver = useMemo(() => entry ? new EffectShowcaseDriver(scenario, { ...entry, windDirection }) : null,
    [scenario, entry, windDirection, replay])
  const isReduced = reducedMotion || forceReduced
  const card = paidCardDef(scenario)!
  const pause = () => {
    if (!driver) return
    if (paused) driver.resume()
    else driver.pause()
    setPaused(!paused)
  }
  const previewGrant = (assetKind: CollectibleGrant['assetKind'], assetId: number) => {
    setGrant({ assetKind, assetId, player: zeroAddress, sessionId: `0x${'00'.repeat(32)}` })
  }

  return <div className="screen effect-showcase" data-testid="screen-effect-showcase">
    {driver ? <RaceScreen key={`${scenario}:${entry!.roster.join(',')}:${windDirection}:${replay}`}
      driver={driver} lang={lang} reducedMotion={isReduced} audio={audio} urls={urls}
      onDone={() => {}} onQuit={() => { setEntry(null); setPaused(false) }}/>
      : <SelectScreen lang={lang} reducedMotion={isReduced} availablePonyIds={ALL_PONIES} rng={keepCatalogOrder}
        balance={null} paidOpen={false} paidHint={t(lang, 'effectShowcase.previewHint')} onBack={onBack}
        onRace={(playerHorseId, _tier, roster) => { setEntry({ playerHorseId, roster }); setPaused(false) }}/>
    }
    <section className="effect-showcase-controls" aria-label={t(lang, 'effectShowcase.title')}>
      <div className="showcase-control-row">
        <strong>{t(lang, 'effectShowcase.title')}</strong>
        <button type="button" onClick={onBack}>{t(lang, 'effectShowcase.back')}</button>
        {driver && <button type="button" onClick={() => { setEntry(null); setPaused(false) }}>{t(lang, 'effectShowcase.selectPony')}</button>}
      </div>
      <select aria-label={t(lang, 'effectShowcase.scenario')} value={scenario}
        onChange={event => { setScenario(event.target.value); setPaused(false) }}>
        {EFFECT_SHOWCASE_SCENARIOS.map(id => <option key={id} value={id}>{id} · {paidCardDef(id)!.name[lang]}</option>)}
      </select>
      <p className="showcase-description" title={card.desc[lang]}>{card.desc[lang]}</p>
      {driver && <div className="showcase-control-row">
        <button type="button" onClick={() => driver.showEffect()}>{t(lang, 'effectShowcase.showEffect')}</button>
        <button type="button" onClick={pause}>{t(lang, paused ? 'effectShowcase.resume' : 'effectShowcase.pause')}</button>
        <button type="button" disabled={!paused} onClick={() => driver.step()}>{t(lang, 'effectShowcase.step')}</button>
        <button type="button" onClick={() => driver.nextEvent()}>{t(lang, 'effectShowcase.nextEvent')}</button>
        <button type="button" onClick={() => { setReplay(n => n + 1); setPaused(false) }}>{t(lang, 'effectShowcase.replay')}</button>
      </div>}
      <div className="showcase-control-row">
        {scenario === 'C-12' && <select aria-label={t(lang, 'effectShowcase.windDirection')} value={windDirection}
          onChange={event => { setWindDirection(event.target.value === '-1' ? -1 : 1); setPaused(false) }}>
          <option value="1">{t(lang, 'effectShowcase.tailwind')}</option>
          <option value="-1">{t(lang, 'effectShowcase.headwind')}</option>
        </select>}
        <label><input type="checkbox" checked={isReduced} disabled={reducedMotion}
          onChange={event => setForceReduced(event.target.checked)}/>{t(lang, 'effectShowcase.reducedMotion')}</label>
      </div>
    </section>
    <section className="effect-showcase-grants" aria-label={t(lang, 'grant.title')}>
      <div className="showcase-control-row">
        <select aria-label={t(lang, 'effectShowcase.grantPony')} value={grantPony} onChange={event => setGrantPony(Number(event.target.value))}>
          {GRANT_PONIES.map(pony => <option key={pony.ponyId} value={pony.ponyId}>{lang === 'zh' ? pony.name : pony.nameEn}</option>)}
        </select>
        <button type="button" onClick={() => previewGrant('pony', grantPony)}>{t(lang, 'effectShowcase.previewPony')}</button>
        <select aria-label={t(lang, 'effectShowcase.grantCard')} value={grantCard} onChange={event => setGrantCard(event.target.value)}>
          {RARE_CARDS.map(rare => <option key={rare.cardId} value={rare.cardId}>{rare.cardId} · {rare.name[lang]}</option>)}
        </select>
        <button type="button" onClick={() => previewGrant('rareCard', Number(grantCard.slice(2)))}>{t(lang, 'effectShowcase.previewCard')}</button>
      </div>
    </section>
    {grant && <CollectibleDialog grant={grant} lang={lang} reducedMotion={isReduced} onClose={() => setGrant(null)}/>}
  </div>
}
