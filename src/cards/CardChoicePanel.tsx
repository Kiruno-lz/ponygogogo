/**
 * 选牌面板。三段动画：发牌入场（错峰落位）、悬浮、选定消失。
 * 硬约束：动画不参与规则。点击的瞬间效果即生效并写进输入序列，飞行与淡出只是表现。
 * 20 秒现实限时从卡牌可交互那一刻起算，不从入场动画开始算。
 */
import { useEffect, useRef, useState } from 'react'
import { CARD_BY_ID } from '../race/cards/pool.ts'
import type { Lang } from '../ui/i18n.ts'
import { t } from '../ui/i18n.ts'
import { Card } from './Card.tsx'

const DEAL_MS = 260
const STAGGER_MS = 110

export interface CardChoicePanelProps {
  candidates: string[]
  checkpoint: number
  refreshCredits: number
  auto: boolean
  timeLeftMs: number
  lang: Lang
  reducedMotion: boolean
  onArmed: () => void
  onPick: (cardId: string) => void
  onSkip: () => void
  onRefresh: (slot: number) => void
  onHover?: () => void
}

export function CardChoicePanel(p: CardChoicePanelProps) {
  const [dealt, setDealt] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [focus, setFocus] = useState(-1)
  const armedRef = useRef(false)
  const btnRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const wait = p.reducedMotion ? 0 : DEAL_MS + STAGGER_MS * (p.candidates.length - 1)
    const id = setTimeout(() => {
      setDealt(true)
      if (!armedRef.current) {
        armedRef.current = true
        p.onArmed()
      }
    }, wait)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.checkpoint])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!dealt || p.auto || chosen !== null) return
      if (e.key === 'ArrowRight') setFocus((f) => Math.min(p.candidates.length - 1, f + 1))
      else if (e.key === 'ArrowLeft') setFocus((f) => Math.max(0, f - 1))
      else if (e.key === 'Enter' && focus >= 0) pick(focus)
      else if (e.key === 'Escape') p.onSkip()
      else if (e.key === 'r' && focus >= 0 && p.refreshCredits > 0) p.onRefresh(focus)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function pick(i: number): void {
    if (!dealt || p.auto || chosen !== null) return
    setChosen(i)
    p.onPick(p.candidates[i]!)
  }

  const secs = Math.max(0, Math.ceil(p.timeLeftMs / 1000))
  const urgent = p.timeLeftMs >= 0 && p.timeLeftMs <= 5000

  return (
    <div
      className="screen"
      data-testid="card-panel"
      style={{
        background: 'rgba(24,15,10,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        zIndex: 60,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <h2
          className="h-title"
          style={{ margin: 0, fontSize: 40, color: '#ffe9c9', textShadow: '0 3px 0 #5b2d10' }}
        >
          {t(p.lang, p.auto ? 'card.auto' : 'card.title')}
        </h2>
        <span
          data-testid="choice-timer"
          className="h-title mono"
          style={{
            fontSize: urgent ? 62 : 40,
            color: urgent ? '#ff6b4a' : '#ffe9c9',
            textShadow: '0 3px 0 #5b2d10',
            transition: 'font-size 150ms ease, color 150ms ease',
            minWidth: 84,
            textAlign: 'center',
          }}
        >
          {p.timeLeftMs < 0 ? '—' : secs}
        </span>
        {urgent && (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              background: '#ff6b4a',
              color: '#fff',
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            !
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start' }}>
        {p.candidates.map((cardId, i) => {
          const def = CARD_BY_ID[cardId]
          if (!def) return null
          const fading = chosen !== null && chosen !== i
          const flying = chosen === i
          return (
            <div
              key={`${p.checkpoint}-${i}-${cardId}`}
              ref={(el) => {
                btnRefs.current[i] = el
              }}
              tabIndex={p.auto ? -1 : 0}
              role="button"
              aria-label={def.name[p.lang]}
              data-testid={`card-choice-${i}`}
              onFocus={() => setFocus(i)}
              onMouseEnter={() => {
                setFocus(i)
                p.onHover?.()
              }}
              onMouseLeave={() => setFocus(-1)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                outline: 'none',
                transform: p.reducedMotion
                  ? 'none'
                  : `translateY(${dealt ? (focus === i ? -16 : 0) : 60}px) scale(${
                      flying ? 0.55 : focus === i ? 1.05 : 1
                    })`,
                opacity: dealt ? (fading ? 0 : 1) : 0,
                transition: `transform 260ms cubic-bezier(0.34,1.4,0.64,1) ${
                  dealt ? 0 : i * STAGGER_MS
                }ms, opacity 240ms ease ${dealt ? 0 : i * STAGGER_MS}ms`,
              }}
            >
              <Card
                def={def}
                lang={p.lang}
                size="choice"
                selected={focus === i}
                onClick={() => pick(i)}
              />
              {p.refreshCredits > 0 && !p.auto && chosen === null && (
                <button
                  type="button"
                  className="chip"
                  data-testid={`card-refresh-${i}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    p.onRefresh(i)
                  }}
                  style={{ fontSize: 18, padding: '6px 16px' }}
                >
                  ⟳ {t(p.lang, 'card.refresh')}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {!p.auto && (
          <button
            type="button"
            className="chip"
            data-testid="card-skip"
            onClick={p.onSkip}
            disabled={chosen !== null}
            style={{ fontSize: 20 }}
          >
            {t(p.lang, 'card.skip')}
          </button>
        )}
        {p.refreshCredits > 0 && (
          <span style={{ color: '#ffe9c9', fontSize: 20, fontWeight: 700 }}>
            {t(p.lang, 'card.refreshLeft', { n: p.refreshCredits })}
          </span>
        )}
      </div>
    </div>
  )
}
