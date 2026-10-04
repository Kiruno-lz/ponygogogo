/**
 * 选马/下注的侧视布局按最新 race_start.png 注册。
 * 五档：0 是免费本地试玩，不碰任何余额；0.3 / 1 / 5 / 10 MON 是有奖档（有奖规则 v3），入口关闭或未登录
 * （`paidOpen = false`）时灰掉不可选。赢奖条写第一名的总返还（3 倍，含本金）。
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { formatMon, formatMonTrim } from '../chain/amount.ts'
import { PRACTICE_TIER, isTierPlayable } from '../chain/paidGate.ts'
import { paidMaxPayout, PAID_STAKE_LABELS } from '../chain/paidStakes.ts'
import { DEFAULT_ROSTER, ponyById, type PonyRoster } from '../game/ponyCatalog.ts'
import { laneGroundY } from '../game/layout.ts'
import { Chip, StarButton, WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { PonyPortrait } from './PonyPortrait.tsx'
import { PlayerPlaque, StaminaArt } from './RaceArt.tsx'
import { createPonySelection, ponySelectionRng, reducePonyInput, selectionEntry, type PonySelectionAction } from './ponySelection.ts'
import { ponyAbilityText } from './ponyAbilityText.ts'

export interface SelectScreenProps {
  lang: Lang
  /** 游戏账户（sma-b）的钱包余额，只作展示；null = 未登录或还没读到 */
  balance: bigint | null
  /** 有奖入口是否开放：chain/paidGate 的 paidEntry（构建期地址、链上代码、游戏账户三者齐备） */
  paidOpen: boolean
  /** 有奖档位灰着时的说明；缺省是「合约尚未部署」 */
  paidHint?: string | null
  availablePonyIds?: readonly number[]
  reducedMotion?: boolean
  rng?: () => number
  rngSeed?: string
  onBack: () => void; onRace: (horseId: number, stakeTier: number, roster: PonyRoster) => void
}

export function SelectScreen(p: SelectScreenProps) {
  const [input, dispatch] = useReducer(reducePonyInput, null, () => ({
    selection: createPonySelection(p.availablePonyIds ?? DEFAULT_ROSTER, p.rng ?? (p.rngSeed ? ponySelectionRng(p.rngSeed) : undefined)), motion: 'none' as const, serial: 0, waiting: null,
  }))
  const column = useRef<HTMLDivElement>(null)
  const focusFromKey = useRef(false)
  const selection = input.selection
  const horseId = selection.selectedPonyId
  const entry = selectionEntry(selection)
  const send = (action: PonySelectionAction) => {
    focusFromKey.current = action.kind === 'key'
    dispatch({ type: 'input', action, reducedMotion: !!p.reducedMotion })
  }
  useEffect(() => { dispatch({ type: 'available', ids: p.availablePonyIds ?? DEFAULT_ROSTER }) }, [p.availablePonyIds])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (document.querySelector('dialog[open], [role="dialog"]')) return
      const target = event.target as HTMLElement | null
      if (target && target !== document.body && target !== document.documentElement
        && !column.current?.contains(target) && !target.closest('[data-pony-queue]')) return
      event.preventDefault()
      focusFromKey.current = true
      dispatch({ type: 'input', action: { kind: 'key', direction: event.key === 'ArrowUp' ? -1 : 1 }, reducedMotion: !!p.reducedMotion })
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [p.reducedMotion])
  useEffect(() => {
    if (focusFromKey.current && horseId !== null) column.current?.querySelector<HTMLButtonElement>(`[data-testid="horse-${horseId}"]`)?.focus({ preventScroll: true })
  }, [horseId, input.serial])
  useEffect(() => {
    if (input.motion === 'none') return
    let cancelled = false
    const serial = input.serial
    const finish = () => { if (!cancelled) dispatch({ type: 'finish', serial }) }
    column.current?.getBoundingClientRect()
    const animations = column.current?.getAnimations({ subtree: true }).filter(a => a instanceof CSSTransition && a.transitionProperty === 'transform') ?? []
    if (animations.length) void Promise.allSettled(animations.map(a => a.finished)).then(finish)
    const timer = window.setTimeout(finish, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [input.serial, input.motion])
  const [tier, setTier] = useState(PRACTICE_TIER)
  const playable = isTierPlayable(tier, p.paidOpen)

  return <div className="screen select-screen" data-testid="screen-select">
    <img className="select-track" src="/assets/art/track/scene.webp" alt="" draggable={false}/>
    <div className="select-start-line"/>
    <PlayerPlaque horseId={horseId ?? 0}/>
    <StaminaArt fraction={1}/>
    {horseId !== null && <div className="select-pony-ability" aria-live="polite">
      <strong>{ponyAbilityText(horseId, p.lang).name}</strong>
      <p>{ponyAbilityText(horseId, p.lang).description}</p>
    </div>}
    {[0, 1, 2, 3, 4].map(lane => <img key={lane} className="lane-pennant select-lane-flag"
      src={`/assets/art/ui/flag-${lane}.webp`} alt={`${lane + 1}`} style={{ top: laneGroundY(lane) - 77 }} draggable={false}/>)}
    <button type="button" data-pony-queue data-testid="pony-queue-up" className="pony-queue-arrow queue-up"
      aria-label={p.lang === 'zh' ? '查看上方小马' : 'Previous ponies'} disabled={selection.windowStart === 0}
      onClick={() => send({ kind: 'scroll', direction: -1 })}><img src="/assets/art/ui/queue-arrow-up.webp" alt="" draggable={false}/></button>
    <button type="button" data-pony-queue data-testid="pony-queue-down" className="pony-queue-arrow queue-down"
      aria-label={p.lang === 'zh' ? '查看下方小马' : 'Next ponies'} disabled={selection.windowStart >= selection.orderedPonyIds.length - 5}
      onClick={() => send({ kind: 'scroll', direction: 1 })}><img src="/assets/art/ui/queue-arrow-up.webp" alt="" draggable={false}/></button>
    <div ref={column} className="pony-selection-column" data-testid="pony-selection-column" data-motion={input.motion}
      role="group" aria-label={p.lang === 'zh' ? '选择小马' : 'Choose a pony'}>
      {horseId !== null && <img className="selection-ground-ring" data-testid="selection-ring"
        src="/assets/art/ui/gold-ring-trimmed.webp" alt="" draggable={false}
        style={{ transform: `translate(${portraitX(selectedLane(selection)) - 8}px, ${groundY(selectedLane(selection)) - 322}px)`,
          transition: input.motion === 'ring' || input.motion === 'queue' ? 'transform 250ms ease-out' : 'none' }}/>}
      {selection.orderedPonyIds.map((id, index) => {
        const k = index - selection.windowStart
        if (k < -1 || k > 5) return null
        const lane = 4 - k, h = ponyById(id), visible = k >= 0 && k < 5
        const movingQueue = input.motion === 'queue' || input.motion === 'queueFixedRing'
        return <button key={id} type="button" className="horse-choice" data-testid={`horse-${id}`} data-lane={lane}
          aria-label={p.lang === 'zh' ? h.name : h.nameEn} aria-pressed={id === horseId} aria-hidden={!visible}
          tabIndex={visible && (id === horseId || (horseId === null && k === 2)) ? 0 : -1}
          disabled={!visible} onClick={() => send({ kind: 'pick', ponyId: id })}
          style={{ transform: `translate(${portraitX(lane)}px, ${groundY(lane) - 402}px)`,
            // Keep adjacent sprites mounted for continuous frames, but never paint them at rest.
            opacity: visible ? 1 : 0, visibility: visible || movingQueue ? 'visible' : 'hidden',
            transition: movingQueue ? 'transform 250ms ease-out, opacity 250ms ease-out' : 'none' }}>
          <PonyPortrait horseId={id} width={178} action="idle" style={{ left: 0 }}/>
        </button>
      })}
    </div>
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
      disabled={entry === null || !playable}
      onClick={() => entry !== null && p.onRace(entry.playerHorseId, tier, entry.roster)}/></div>
    <div className="select-back"><WoodButton zh={t(p.lang, 'select.back')} onClick={p.onBack} style={{ minWidth: 126, minHeight: 46 }}/></div>
  </div>
}

function selectedLane(selection: { orderedPonyIds: readonly number[]; windowStart: number; selectedPonyId: number | null }): number {
  return 4 - (selection.orderedPonyIds.indexOf(selection.selectedPonyId!) - selection.windowStart)
}
function portraitX(lane: number): number { return [86, 107, 123, 130, 144][Math.max(0, Math.min(4, lane))]! }
function groundY(lane: number): number {
  return lane < 0 ? laneGroundY(0) - lane * 89 : lane > 4 ? laneGroundY(4) - (lane - 4) * 74 : laneGroundY(lane)
}
