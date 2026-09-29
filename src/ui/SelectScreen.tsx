/**
 * 选马/下注的侧视布局按最新 race_start.png 注册。
 * 五档：0 是免费本地试玩，不碰任何余额；0.3 / 1 / 5 / 10 MON 是有奖档（有奖规则 v3），入口关闭或未登录
 * （`paidOpen = false`）时灰掉不可选。赢奖条写第一名的总返还（3 倍，含本金）。
 */
import { useState } from 'react'
import { formatMon, formatMonTrim } from '../chain/amount.ts'
import { PRACTICE_TIER, isTierPlayable } from '../chain/paidGate.ts'
import { paidMaxPayout, PAID_STAKE_LABELS } from '../chain/paidStakes.ts'
import { HORSE_PROFILES } from '../game/horses.ts'
import { laneGroundY } from '../game/layout.ts'
import { Chip, StarButton, WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { PonyPortrait } from './PonyPortrait.tsx'
import { PlayerPlaque, StaminaArt } from './RaceArt.tsx'

export interface SelectScreenProps {
  lang: Lang
  /** 游戏账户（sma-b）的钱包余额，只作展示；null = 未登录或还没读到 */
  balance: bigint | null
  /** 有奖入口是否开放：chain/paidGate 的 paidEntry（构建期地址、链上代码、游戏账户三者齐备） */
  paidOpen: boolean
  /** 有奖档位灰着时的说明；缺省是「合约尚未部署」 */
  paidHint?: string | null
  onBack: () => void; onRace: (horseId: number, stakeTier: number) => void
}

export function SelectScreen(p: SelectScreenProps) {
  const [horseId, setHorseId] = useState<number | null>(null)
  const [tier, setTier] = useState(PRACTICE_TIER)
  const playable = isTierPlayable(tier, p.paidOpen)

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
      <div className="bet-balance"><img src="/assets/art/ui/coin-trimmed.webp" alt=""/><span data-testid="select-balance">{p.balance === null ? '—' : `${formatMon(p.balance)} MON`}</span></div>
      <h2>{p.lang === 'en' ? 'Choose your bet' : t(p.lang, 'select.chooseBet')}</h2>
      <div className="bet-chips">
        {PAID_STAKE_LABELS.map((v, i) => <Chip key={v} label={v} on={i === tier}
          disabled={!isTierPlayable(i, p.paidOpen)} onClick={() => setTier(i)} />)}
      </div>
      {!p.paidOpen && <div className="bet-paid-closed" data-testid="paid-closed">{p.paidHint ?? t(p.lang, 'select.paidNotDeployed')}</div>}
      <div className="bet-win"><img src="/assets/art/ui/coin-trimmed.webp" alt=""/><span data-testid="potential-win">{tier === PRACTICE_TIER ? t(p.lang, 'select.freeWin') : `${formatMonTrim(paidMaxPayout(tier as 1 | 2 | 3 | 4))} MON`}</span><img src="/assets/art/ui/horseshoe-trimmed.webp" alt=""/></div>
      <div className="bet-difficulty"><span>{t(p.lang, 'select.difficulty')}</span><strong data-testid="difficulty">{t(p.lang, `select.tier${tier}`)}</strong></div>
    </div>
    <div className="select-race-cta"><StarButton big={`${t(p.lang, 'select.race')}!`}
      sub={horseId === null ? t(p.lang, 'select.chooseHorse') : undefined}
      disabled={horseId === null || !playable}
      onClick={() => horseId !== null && p.onRace(horseId, tier)}/></div>
    <div className="select-back"><WoodButton zh={t(p.lang, 'select.back')} onClick={p.onBack} style={{ minWidth: 126, minHeight: 46 }}/></div>
  </div>
}
