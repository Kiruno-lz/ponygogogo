import { paidCardDef } from '../race/cards/paidCards.ts'
import { cardIconUrl } from '../race/cards/iconUrl.ts'
/**
 * 竞速 HUD。布局对齐 art-src/renders/race_gaming.png：
 * 左上玩家头像牌、顶部体力条、体力条下方的状态图标行、右侧羊皮纸名次榜、右下 GOGOGO 星形按钮。
 */
import { useEffect, useRef, useState } from 'react'
import { SIM_HZ, STAMINA_MAX, TRACK_LEN } from '../race/core/constants.ts'
import type { EffectInstance, RaceState } from '../race/core/types.ts'
import { hexCss } from '../game/horses.ts'
import { ponyById, ponyIdAt } from '../game/ponyCatalog.ts'
import { t, type Lang } from './i18n.ts'
import { PlayerPlaque, StaminaArt } from './RaceArt.tsx'
import { ponyAbilityText } from './ponyAbilityText.ts'

const HUD_ICON: Record<string, string> = {
  'C-01': 'buff-wing',
  'C-14': 'buff-leaf',
  'C-11': 'buff-fire',
  'C-21': 'buff-eye',
}

const SYSTEM_ICON: Record<string, string> = {
  'system.exhaust': 'icon_04',
  'system.death': 'icon_12',
  'system.swapcd': 'icon_11',
  'system.wheelhold': 'icon_15',
}

interface Slot {
  label?: string
  key: string
  icon: string
  tint?: number
  secsLeft: number | null
  stacks: number
  debuff: boolean
}

function buildSlots(state: RaceState, horseId: number, lang: Lang): Slot[] {
  const byCard = new Map<string, Slot>()
  const push = (inst: EffectInstance): void => {
    const def = paidCardDef(inst.sourceCardId)
    const ponyId = typeof inst.payload.ponyId === 'number' ? inst.payload.ponyId : null
    const icon = ponyId === null ? HUD_ICON[inst.sourceCardId] ?? def?.art.icon ?? SYSTEM_ICON[inst.sourceCardId] : `/assets/art/ponies/${ponyId}-portrait.webp`
    if (!icon) return
    const left =
      inst.durationTicks === null
        ? null
        : Math.max(0, Math.ceil((inst.durationTicks - (state.tick - inst.appliedAtTick)) / SIM_HZ))
    const prev = byCard.get(inst.sourceCardId)
    const stacks = (inst.payload.stacks as number) ?? 0
    if (prev) {
      if (left !== null && prev.secsLeft !== null) prev.secsLeft = Math.max(prev.secsLeft, left)
      if (left === null) prev.secsLeft = null
      prev.stacks = Math.max(prev.stacks, stacks)
      return
    }
    byCard.set(inst.sourceCardId, {
      key: inst.sourceCardId,
      label: ponyId === null ? undefined : ponyAbilityText(ponyId, lang).name,
      icon,
      tint: def?.art.tint,
      secsLeft: left,
      stacks,
      debuff: inst.tags.includes('debuff'),
    })
  }
  for (const inst of state.effects) if (inst.ownerHorseId === horseId) push(inst)
  if (state.env) push(state.env)
  return [...byCard.values()].slice(0, 8)
}

function StatusBadge({ slot, reduced }: { slot: Slot; reduced: boolean }) {
  const [pop, setPop] = useState(true)
  const lastStacks = useRef(slot.stacks)
  useEffect(() => {
    if (slot.stacks !== lastStacks.current) {
      lastStacks.current = slot.stacks
      setPop(false)
      requestAnimationFrame(() => setPop(true))
    }
  }, [slot.stacks])
  return (
    <div
      data-testid={`buff-${slot.key}`}
      title={slot.label}
      aria-label={slot.label}
      className={`badge${pop && !reduced ? ' pop' : ''}`}
      style={{ width: 70, textAlign: 'center' }}
    >
      <div
        style={{
          width: 70,
          height: 74,
          borderRadius: 14,
          background: slot.debuff ? 'rgba(120,30,24,0.55)' : 'rgba(40,28,20,0.5)',
          border: `3px solid ${slot.debuff ? '#c4553f' : '#7a5336'}`,
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          filter: slot.debuff ? 'drop-shadow(0 0 3px #d85845)' : undefined,
        }}
      >
        <img
          src={slot.icon.startsWith('/assets/') ? slot.icon : slot.icon.startsWith('buff-') ? `/assets/art/ui/${slot.icon}-trimmed.webp` : cardIconUrl(slot.icon)}
          alt=""
          style={{
            width: 54,
            height: 54,
            objectFit: 'contain',
            filter: slot.tint ? `hue-rotate(${slot.tint}deg) saturate(1.2)` : undefined,
          }}
        />
        {slot.stacks > 0 && (
          <span
            style={{
              position: 'absolute',
              right: -6,
              top: -6,
              minWidth: 24,
              padding: '1px 5px',
              borderRadius: 999,
              background: '#e0492f',
              color: '#fff',
              fontSize: 15,
              fontWeight: 900,
            }}
          >
            {slot.stacks}
          </span>
        )}
      </div>
      <span
        className="mono"
        style={{ fontSize: 26, fontFamily: 'Kalam, sans-serif', fontWeight: 700, color: '#ffe9c9', textShadow: '0 2px 0 #4a2a14' }}
      >
        {slot.secsLeft === null ? '∞' : slot.secsLeft}
      </span>
    </div>
  )
}

export interface HudProps {
  state: RaceState
  lang: Lang
  reducedMotion: boolean
  gogoPunchKey: number
  onGogoDown: () => void
  onGogoUp: () => void
  hideGogo: boolean
}

export function Hud(p: HudProps) {
  const st = p.state
  const player = st.horses[st.playerHorseId]!
  const slots = buildSlots(st, player.horseId, p.lang)
  const staminaPct = Math.max(0, Math.min(1.2, player.stamina / STAMINA_MAX))
  const exhausted = st.effects.some(
    (e) => e.ownerHorseId === player.horseId && e.payload.statusId === 'exhausted',
  )
  const over = player.stamina > STAMINA_MAX

  const board = [...st.horses].sort((a, b) => {
    if (a.finished && b.finished) return a.rank - b.rank
    if (a.finished) return -1
    if (b.finished) return 1
    return b.pos - a.pos
  })

  return (
    <div className="screen race-hud" style={{ pointerEvents: 'none', zIndex: 50 }}>
      <PlayerPlaque horseId={ponyIdAt(st.roster, player.horseId)} />
      <StaminaArt fraction={staminaPct} exhausted={exhausted} over={over}>
        {exhausted && <span className="stamina-exhausted" data-testid="exhausted">{t(p.lang, 'race.exhausted')}</span>}
      </StaminaArt>

      {/* 状态图标行 */}
      <div style={{ position: 'absolute', left: 277, top: 112, display: 'flex', gap: 15 }}>
        {slots.map((s) => (
          <StatusBadge key={s.key} slot={s} reduced={p.reducedMotion} />
        ))}
      </div>

      {/* 右侧：名次榜 */}
      <div
        className="leaderboard-art"
        data-testid="leaderboard"
        style={{
          position: 'absolute',
          left: 1259,
          top: 72,
          width: 360,
          height: 475,
          padding: '115px 36px 25px 47px',
        }}
      >

        {board.map((h, i) => {
          const prof = ponyById(ponyIdAt(st.roster, h.horseId))
          const me = h.horseId === st.playerHorseId
          return (
            <div
              key={h.horseId}
              data-testid={`board-row-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                height: 60,
                padding: '0 6px',
                borderRadius: 7,
                background: me ? 'rgba(244,162,42,0.42)' : 'transparent',
                borderBottom: '2px solid rgba(255,239,218,0.55)',
              }}
            >
              <span className="h-title" style={{ width: 22, fontSize: 22 }}>
                {i + 1}
              </span>
              <HorseAvatar horseId={prof.ponyId} size={50} />
              <span style={{ flex: 1, fontSize: 22, fontWeight: 700 }}>{prof.name}</span>
              <span
                className="mono"
                style={{ fontSize: 15, opacity: 0.8, width: 56, textAlign: 'right', whiteSpace: 'nowrap' }}
              >
                {h.finished ? (h.finishTick / SIM_HZ).toFixed(1) + 's' : '--:--'}
              </span>
            </div>
          )
        })}
      </div>

      {/* 右下：GOGOGO */}
      {!p.hideGogo && (
        <div style={{ position: 'absolute', left: 1190, top: 565, pointerEvents: 'auto' }}>
          <GogoButton
            punchKey={p.gogoPunchKey}
            reduced={p.reducedMotion}
            onDown={p.onGogoDown}
            onUp={p.onGogoUp}
          />
        </div>
      )}

      {/* 进度条：玩家在赛道上的位置 */}
      <div
        style={{
          position: 'absolute',
          left: 52,
          bottom: 18,
          width: 1100,
          height: 12,
          borderRadius: 8,
          background: 'rgba(30,20,14,0.5)',
          border: '2px solid rgba(255,233,201,0.35)',
        }}
      >
        {st.horses.map((h) => (
          <div
            key={h.horseId}
            style={{
              position: 'absolute',
              left: `${Math.min(100, (h.pos / TRACK_LEN) * 100)}%`,
              top: h.horseId === st.playerHorseId ? -6 : -2,
              width: h.horseId === st.playerHorseId ? 14 : 9,
              height: h.horseId === st.playerHorseId ? 20 : 12,
              marginLeft: -5,
              borderRadius: 4,
              background: hexCss(ponyById(ponyIdAt(st.roster, h.horseId)).mane),
              border: h.horseId === st.playerHorseId ? '2px solid #fff3d2' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function HorseAvatar({ horseId, size }: { horseId: number; size: number }) {
  // The initial five have dedicated head crops; later roles use their shared portrait artwork.
  const image = horseId < 5 ? `/assets/art/ui/leaderboard-avatar-${horseId}.webp`
    : `/assets/art/ponies/${horseId}-portrait.webp`
  return <div className="horse-avatar" style={{ width: size, height: size }}>
    <img src={image} alt={ponyById(horseId).name} draggable={false}/>
  </div>
}

function GogoButton({
  punchKey,
  reduced,
  onDown,
  onUp,
}: {
  punchKey: number
  reduced: boolean
  onDown: () => void
  onUp: () => void
}) {
  const [anim, setAnim] = useState(false)
  const [pressed, setPressed] = useState(false)
  useEffect(() => {
    if (punchKey === 0 || reduced) return
    setAnim(false)
    const id = requestAnimationFrame(() => setAnim(true))
    return () => cancelAnimationFrame(id)
  }, [punchKey, reduced])
  // gogo 在通用按下缩放之上叠加一次完整旋转。
  return (
    <button
      type="button"
      data-testid="gogo"
      className={`btn btn-star gogo${anim ? ' punch' : ''}${pressed ? ' pressed' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault()
        setPressed(true)
        onDown()
      }}
      onPointerUp={() => {
        setPressed(false)
        onUp()
      }}
      onPointerLeave={() => {
        setPressed(false)
        onUp()
      }}
      style={{ width: 429, height: 390 }}
    >
      <span className="big h-title">GOGOGO</span>
    </button>
  )
}
