/** 选马/下注的侧视布局按最新 race_start.png 注册；原有选择与下注规则不变。 */
import { useState } from 'react'
import { formatMon, MON } from '../chain/port.ts'
import { PAYOUT_TABLE, STAKE_PRESETS } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import { HORSE_PROFILES } from '../game/horses.ts'
import { laneGroundY } from '../game/layout.ts'
import { Chip, StarButton, WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { PonyPortrait } from './PonyPortrait.tsx'
import { PlayerPlaque, StaminaArt } from './RaceArt.tsx'

export interface SelectScreenProps {
  lang: Lang; balance: bigint; entering: boolean; error: string | null
  onBack: () => void; onRace: (horseId: number, stakeTier: number) => void
}

export function SelectScreen(p: SelectScreenProps) {
  const [horseId, setHorseId] = useState<number | null>(null)
  const [tier, setTier] = useState(0)
  const stake = BigInt(STAKE_PRESETS[tier]!) * MON
  const potential = Math.round((STAKE_PRESETS[tier]! * PAYOUT_TABLE[0]!) / FP)
  const affordable = stake <= p.balance

  return <div className="screen select-screen" data-testid="screen-select">
    <img className="select-track" src="/assets/art/track/scene.webp" alt="" draggable={false}/>
    <div className="select-start-line"/>
    <PlayerPlaque horseId={horseId ?? 0}/>
    <StaminaArt fraction={1}/>
    {HORSE_PROFILES.map(h => {
      const on = horseId === h.horseId
      const portraitLeft = [86, 107, 123, 130, 144][h.horseId]!
      return <button key={h.horseId} type="button" className={`horse-choice${on ? ' selected' : ''}`}
        data-testid={`horse-${h.horseId}`} aria-label={h.name} aria-pressed={on}
        onClick={() => setHorseId(h.horseId)} style={{ top: laneGroundY(h.horseId) - 112 }}>
        <img className="lane-pennant" src={`/assets/art/ui/flag-${h.horseId}.webp`} alt={`${h.horseId + 1}`} draggable={false}/>
        <PonyPortrait horseId={h.horseId} width={178} action="idle" style={{ left: portraitLeft }}/>
        <img className="horse-ground-ring" style={{ left: portraitLeft - 8 }} src="/assets/art/ui/gold-ring-trimmed.webp" alt="" draggable={false}/>
      </button>
    })}
    <div className="bet-art-panel" data-testid="bet-panel">
      <div className="bet-balance"><img src="/assets/art/ui/coin-trimmed.webp" alt=""/><span>{formatMon(p.balance)} MON</span></div>
      <h2>{p.lang === 'en' ? 'Choose your bet' : t(p.lang, 'select.chooseBet')}</h2>
      <div className="bet-chips">
        {STAKE_PRESETS.map((v, i) => <Chip key={v} label={v} on={i === tier} onClick={() => setTier(i)} />)}
      </div>
      <div className="bet-win"><img src="/assets/art/ui/coin-trimmed.webp" alt=""/><span data-testid="potential-win">{t(p.lang, 'select.uwin', { n: potential })}</span><img src="/assets/art/ui/horseshoe-trimmed.webp" alt=""/></div>
      <div className="bet-difficulty"><span>{t(p.lang, 'select.difficulty')}</span><strong data-testid="difficulty">{t(p.lang, `select.tier${tier}`)}</strong></div>
      {!affordable && <div className="bet-error">{t(p.lang, 'select.insufficient')}</div>}
    </div>
    <div className="select-race-cta"><StarButton big={p.entering ? '…' : `${t(p.lang, 'select.race')}!`}
      sub={horseId === null ? t(p.lang, 'select.chooseHorse') : undefined}
      disabled={horseId === null || p.entering || !affordable}
      onClick={() => horseId !== null && p.onRace(horseId, tier)}/></div>
    <div className="select-back"><WoodButton zh={t(p.lang, 'select.back')} onClick={p.onBack} style={{ minWidth: 126, minHeight: 46 }}/></div>
    {p.error && <div className="panel select-error" data-testid="enter-error"><strong>{t(p.lang, 'select.enterFailed')}</strong></div>}
  </div>
}
