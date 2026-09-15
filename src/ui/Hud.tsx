/**
 * 竞速 HUD。布局对齐 assrt/race_gaming.png：
 * 左上玩家头像牌、顶部体力条、体力条下方的状态图标行、右侧羊皮纸名次榜、右下 GOGOGO 星形按钮。
 */
import { useEffect, useRef, useState } from 'react'
import { SIM_HZ, STAMINA_MAX, TRACK_LEN } from '../race/core/constants.ts'
import { CARD_BY_ID } from '../race/cards/pool.ts'
import type { EffectInstance, RaceState } from '../race/core/types.ts'
import { HORSE_PROFILES, hexCss } from '../game/horses.ts'
import { t, type Lang } from './i18n.ts'

const SYSTEM_ICON: Record<string, string> = {
  'system.exhaust': 'icon_04',
  'system.death': 'icon_12',
  'system.swapcd': 'icon_11',
  'system.wheelhold': 'icon_15',
}

interface Slot {
  key: string
  icon: string
  tint?: number
  secsLeft: number | null
  stacks: number
  debuff: boolean
}

function buildSlots(state: RaceState, horseId: number): Slot[] {
  const byCard = new Map<string, Slot>()
  const push = (inst: EffectInstance): void => {
    const def = CARD_BY_ID[inst.sourceCardId]
    const icon = def?.art.icon ?? SYSTEM_ICON[inst.sourceCardId]
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
      className={`badge${pop && !reduced ? ' pop' : ''}`}
      style={{ width: 62, textAlign: 'center' }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: 14,
          background: slot.debuff ? 'rgba(120,30,24,0.55)' : 'rgba(40,28,20,0.5)',
          border: `3px solid ${slot.debuff ? '#c4553f' : '#7a5336'}`,
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
        }}
      >
        <img
          src={`/assets/placeholder/icons/${slot.icon}.png`}
          alt=""
          style={{
            width: 48,
            height: 48,
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
        style={{ fontSize: 17, fontWeight: 800, color: '#ffe9c9', textShadow: '0 2px 0 #4a2a14' }}
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
  potentialWin: number
  gogoPunchKey: number
  onGogoDown: () => void
  onGogoUp: () => void
  hideGogo: boolean
  abilityLabel: string | null
}

export function Hud(p: HudProps) {
  const st = p.state
  const player = st.horses[st.playerHorseId]!
  const profile = HORSE_PROFILES[player.horseId]!
  const slots = buildSlots(st, player.horseId)
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
    <div className="screen" style={{ pointerEvents: 'none', zIndex: 50 }}>
      {/* 左上：玩家头像牌 */}
      <div
        className="panel"
        style={{
          position: 'absolute',
          left: 52,
          top: 22,
          width: 186,
          height: 196,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <span style={{ fontSize: 26, marginTop: -6 }}>👑</span>
        <HorseAvatar horseId={player.horseId} size={72} />
        <span className="h-title" style={{ fontSize: 22, marginTop: 6 }}>
          {profile.name}
        </span>
      </div>

      {/* 顶部：体力条 */}
      <div style={{ position: 'absolute', left: 262, top: 34, width: 430 }}>
        <div
          data-testid="stamina-bar"
          style={{
            position: 'relative',
            height: 46,
            borderRadius: 10,
            background: '#6d4a30',
            border: '4px solid #4d3120',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${Math.min(1, staminaPct) * 100}%`,
              // 超上限时用跑马灯配色，一眼看出「这是多出来的」
              backgroundImage: exhausted
                ? 'linear-gradient(#8f6a42,#6d4a2c)'
                : over
                  ? 'repeating-linear-gradient(115deg,#fff6cf 0 14px,#ffd75e 14px 28px)'
                  : 'linear-gradient(#ffd75e,#f0a326)',
              transition: 'width 90ms linear',
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: -20,
              top: -6,
              fontSize: 34,
              filter: 'drop-shadow(0 2px 0 #4d3120)',
            }}
          >
            ⚡
          </span>
          {exhausted && (
            <span
              data-testid="exhausted"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                color: '#ffdcae',
                letterSpacing: 3,
                fontSize: 20,
              }}
            >
              {t(p.lang, 'race.exhausted')}
            </span>
          )}
        </div>
      </div>

      {/* 状态图标行 */}
      <div style={{ position: 'absolute', left: 272, top: 96, display: 'flex', gap: 14 }}>
        {slots.map((s) => (
          <StatusBadge key={s.key} slot={s} reduced={p.reducedMotion} />
        ))}
      </div>

      {/* 右侧：名次榜 */}
      <div
        className="panel"
        data-testid="leaderboard"
        style={{
          position: 'absolute',
          left: 1272,
          top: 88,
          width: 322,
          height: 424,
          padding: '4px 6px',
        }}
      >
        <div style={{ textAlign: 'right', fontSize: 30, lineHeight: 1, marginBottom: 4 }}>👑</div>
        {board.map((h, i) => {
          const prof = HORSE_PROFILES[h.horseId]!
          const me = h.horseId === st.playerHorseId
          return (
            <div
              key={h.horseId}
              data-testid={`board-row-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                height: 56,
                padding: '0 6px',
                borderRadius: 10,
                background: me ? 'rgba(244,162,42,0.42)' : 'transparent',
                borderBottom: '2px solid rgba(120,80,50,0.25)',
              }}
            >
              <span className="h-title" style={{ width: 22, fontSize: 22 }}>
                {i + 1}
              </span>
              <HorseAvatar horseId={h.horseId} size={38} />
              <span style={{ flex: 1, fontSize: 19, fontWeight: 700 }}>{prof.name}</span>
              <span
                className="mono"
                style={{ fontSize: 15, opacity: 0.8, width: 56, textAlign: 'right', whiteSpace: 'nowrap' }}
              >
                {h.finished ? (h.finishTick / SIM_HZ).toFixed(1) + 's' : '—'}
              </span>
            </div>
          )
        })}
      </div>

      {/* 右下：GOGOGO */}
      {!p.hideGogo && (
        <div style={{ position: 'absolute', left: 1218, top: 606, pointerEvents: 'auto' }}>
          <GogoButton
            label={p.abilityLabel ?? t(p.lang, 'race.gogo')}
            sub={t(p.lang, 'select.uwin', { n: p.potentialWin })}
            punchKey={p.gogoPunchKey}
            reduced={p.reducedMotion}
            disabled={exhausted}
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
              background: hexCss(HORSE_PROFILES[h.horseId]!.mane),
              border: h.horseId === st.playerHorseId ? '2px solid #fff3d2' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function HorseAvatar({ horseId, size }: { horseId: number; size: number }) {
  const p = HORSE_PROFILES[horseId]!
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: hexCss(p.body),
        border: `${Math.max(2, size * 0.06)}px solid #5b3a22`,
        position: 'relative',
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '46%',
          height: '100%',
          background: hexCss(p.mane),
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '18%',
          top: '36%',
          width: size * 0.14,
          height: size * 0.14,
          borderRadius: '50%',
          background: '#201510',
        }}
      />
    </div>
  )
}

function GogoButton({
  label,
  sub,
  punchKey,
  reduced,
  disabled,
  onDown,
  onUp,
}: {
  label: string
  sub: string
  punchKey: number
  reduced: boolean
  disabled: boolean
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
  // gogo 在通用按下缩放之上叠加一次完整旋转（docs/plan/demo.md §5.1.2）
  return (
    <button
      type="button"
      data-testid="gogo"
      className={`btn btn-star gogo${anim ? ' punch' : ''}${pressed ? ' pressed' : ''}`}
      disabled={disabled}
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
      style={{ minWidth: 372, minHeight: 262 }}
    >
      <span className="big h-title">{label}</span>
      <span className="sub">{sub}</span>
    </button>
  )
}
