import { useMemo, useState } from 'react'
import type { AudioManager } from '../assets/audio.ts'
import type { EffectShowcaseScenario } from '../game/effectShowcase.ts'
import { EFFECT_SHOWCASE_SCENARIOS, EffectShowcaseDriver } from '../game/effectShowcase.ts'
import { CARD_BY_ID } from '../race/cards/pool.ts'
import { RaceScreen } from './RaceScreen.tsx'
import { t, type Lang } from './i18n.ts'

export function EffectShowcaseScreen({ lang, reducedMotion, audio, urls, onBack }: {
  lang: Lang
  reducedMotion: boolean
  audio: AudioManager
  urls: Record<string, string>
  onBack: () => void
}) {
  const [scenario, setScenario] = useState<EffectShowcaseScenario>('C-02')
  const [paused, setPaused] = useState(false)
  const [forceReduced, setForceReduced] = useState(false)
  const driver = useMemo(() => new EffectShowcaseDriver(scenario), [scenario])
  const isReduced = reducedMotion || forceReduced
  const card = CARD_BY_ID[scenario]!

  const togglePause = () => {
    if (paused) driver.resume()
    else driver.pause()
    setPaused(!paused)
  }

  return <div style={{ position: 'absolute', inset: 0 }}>
    <RaceScreen
      key={scenario}
      driver={driver}
      lang={lang}
      reducedMotion={isReduced}
      audio={audio}
      urls={urls}
      onSceneReady={() => driver.restart()}
      onDone={() => {}}
      onQuit={onBack}
    />
    <div style={{
      position: 'absolute', zIndex: 90, top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8,
      maxWidth: 'calc(100% - 24px)', padding: '8px 10px', borderRadius: 8, flexWrap: 'wrap',
      color: '#fff4df', background: 'rgba(44, 29, 20, .88)', font: '600 14px sans-serif', pointerEvents: 'auto',
    }}>
      <strong>{t(lang, 'effectShowcase.title')}</strong>
      <select aria-label={t(lang, 'effectShowcase.scenario')} value={scenario}
        onChange={(event) => { setScenario(event.target.value as EffectShowcaseScenario); setPaused(false) }}>
        {EFFECT_SHOWCASE_SCENARIOS.map((item) => <option key={item} value={item}>{item} · {CARD_BY_ID[item]!.name[lang]}</option>)}
      </select>
      {scenario === 'C-12' && <select aria-label={t(lang, 'effectShowcase.windDirection')} defaultValue="1"
        onChange={(event) => driver.setWindDirection(event.target.value === '-1' ? -1 : 1)}>
        <option value="1">{t(lang, 'effectShowcase.tailwind')}</option>
        <option value="-1">{t(lang, 'effectShowcase.headwind')}</option>
      </select>}
      <span title={card.desc[lang]} style={{ maxWidth: 320, whiteSpace: 'normal' }}>{card.desc[lang]}</span>
      <button type="button" onClick={togglePause}>{t(lang, paused ? 'effectShowcase.resume' : 'effectShowcase.pause')}</button>
      <button type="button" disabled={!paused} onClick={() => driver.step()}>{t(lang, 'effectShowcase.step')}</button>
      <button type="button" onClick={() => { driver.restart(); setPaused(false) }}>{t(lang, 'effectShowcase.replay')}</button>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={isReduced} disabled={reducedMotion} onChange={(event) => setForceReduced(event.target.checked)} />
        {t(lang, 'effectShowcase.reducedMotion')}
      </label>
      <button type="button" onClick={onBack}>{t(lang, 'effectShowcase.back')}</button>
    </div>
  </div>
}
