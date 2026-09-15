/**
 * 选马 + 下注。构图对齐 assrt/race_start.png：
 * 中央闸门与五匹马、编号彩旗、右侧下注面板、右下 RACE 星形按钮、左侧告示牌。
 */
import { useState } from 'react'
import { formatMon, MON } from '../chain/port.ts'
import { PAYOUT_TABLE, STAKE_PRESETS } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import { HORSE_PROFILES } from '../game/horses.ts'
import { Chip, StarButton, WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { PonyPortrait } from './PonyPortrait.tsx'

const BANNER_COLORS = ['#f0c250', '#7aa9e8', '#f19ab4', '#cfe0ef', '#f3d24e']

export interface SelectScreenProps {
  lang: Lang
  balance: bigint
  entering: boolean
  error: string | null
  onBack: () => void
  onRace: (horseId: number, stakeTier: number) => void
}

export function SelectScreen(p: SelectScreenProps) {
  const [horseId, setHorseId] = useState<number | null>(null)
  const [tier, setTier] = useState(0)
  const stake = BigInt(STAKE_PRESETS[tier]!) * MON
  const potential = Math.round((STAKE_PRESETS[tier]! * PAYOUT_TABLE[0]!) / FP)
  const affordable = stake <= p.balance

  return (
    <div
      className="screen"
      data-testid="screen-select"
      style={{
        background: 'linear-gradient(#7fb2f7 0%, #a9d0f7 42%, #7fa860 55%, #b77249 68%)',
        overflow: 'hidden',
      }}
    >
      {/* 远景：天空 / 城堡 / 松林 / 看台，与比赛画面同一份素材 */}
      <img
        src="/assets/placeholder/bg/far_clean.png"
        alt=""
        draggable={false}
        style={{ position: 'absolute', left: 0, top: 0, width: 1600, height: 265, objectFit: 'cover', objectPosition: 'left top' }}
      />
      <div style={{ position: 'absolute', left: 0, top: 250, width: 1600, height: 130, background: '#58924e' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 372,
          width: 1600,
          height: 578,
          background: 'repeating-linear-gradient(90deg,#b77249 0 96px,#b16c43 96px 192px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 372,
          width: 1600,
          height: 10,
          background: '#8a5431',
        }}
      />

      {/* 闸门：屋顶横梁 + 六根立柱围出五个闸位 */}
      <div
        style={{
          position: 'absolute',
          left: 196,
          top: 232,
          width: 1010,
          height: 62,
          background: 'linear-gradient(#c69068,#9c6a47)',
          border: '5px solid #6f4527',
          borderRadius: 6,
          boxShadow: '0 10px 22px rgba(0,0,0,0.25)',
        }}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={`post-${i}`}
          style={{
            position: 'absolute',
            left: 196 + i * 196,
            top: 288,
            width: 26,
            height: 330,
            background: 'linear-gradient(90deg,#b07c55,#8a5b38)',
            border: '4px solid #6f4527',
            borderRadius: 4,
          }}
        />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={`stall-${i}`}
          style={{
            position: 'absolute',
            left: 222 + i * 196,
            top: 288,
            width: 170,
            height: 330,
            background: 'linear-gradient(180deg,rgba(92,60,38,0.55),rgba(92,60,38,0.18))',
            borderBottom: '8px solid #6f4527',
          }}
        >
          <div style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 58, background: 'repeating-linear-gradient(90deg,#a97650 0 22px,#8d6040 22px 30px)', borderTop: '5px solid #6f4527' }} />
        </div>
      ))}

      {/* 左侧告示牌 */}
      <div
        className="panel"
        style={{
          position: 'absolute',
          left: 24,
          top: 430,
          width: 216,
          height: 200,
          display: 'grid',
          placeItems: 'center',
          fontSize: 30,
          lineHeight: 1.3,
          fontWeight: 800,
          transform: 'rotate(-2deg)',
        }}
      >
        <span>
          Run 👑
          <br />
          Collect
          <br />
          Play
        </span>
      </div>

      {/* 标题 */}
      <div style={{ position: 'absolute', left: 0, top: 108, width: 1404, textAlign: 'center' }}>
        <div style={{ fontSize: 44 }}>👑</div>
        <div
          className="h-title"
          style={{
            fontSize: 84,
            color: '#efe2d0',
            textShadow: '0 6px 0 #8a5f3f, 0 10px 18px rgba(0,0,0,0.35)',
            letterSpacing: 4,
          }}
        >
          {t(p.lang, 'select.title')}
        </div>
        <div style={{ fontSize: 20, color: '#f1cdb0', marginTop: -6, letterSpacing: 4, textShadow: '0 2px 0 #5b3a18' }}>Ponygogogo</div>
      </div>

      {/* 五匹马 */}
      <div
        style={{
          position: 'absolute',
          left: 210,
          top: 330,
          width: 982,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        {HORSE_PROFILES.map((h) => {
          const on = horseId === h.horseId
          return (
            <button
              key={h.horseId}
              type="button"
              data-testid={`horse-${h.horseId}`}
              aria-pressed={on}
              onClick={() => setHorseId(h.horseId)}
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transform: on ? 'translateY(-10px) scale(1.06)' : 'none',
                transition: 'transform 200ms cubic-bezier(0.34,1.4,0.64,1)',
                filter: on ? 'drop-shadow(0 0 18px rgba(249,199,79,0.95))' : 'none',
              }}
            >
              <span
                style={{
                  width: 52,
                  padding: '6px 0 14px',
                  background: BANNER_COLORS[h.horseId],
                  clipPath: 'polygon(0 0,100% 0,100% 78%,50% 100%,0 78%)',
                  color: '#5b3a22',
                  fontWeight: 900,
                  fontSize: 26,
                  marginBottom: -10,
                  border: '2px solid rgba(90,58,34,0.35)',
                }}
              >
                {h.horseId + 1}
              </span>
              <PonyPortrait horseId={h.horseId} width={182} />
              <span
                style={{
                  height: 16,
                  width: 120,
                  borderRadius: '50%',
                  marginTop: -14,
                  background: on ? 'rgba(249,199,79,0.55)' : 'transparent',
                  border: on ? '4px solid #f9c74f' : '4px solid transparent',
                }}
              />
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#4a2a14',
                  marginTop: 6,
                  padding: '2px 12px',
                  borderRadius: 8,
                  background: on ? 'rgba(249,199,79,0.92)' : 'rgba(241,205,176,0.9)',
                  border: '2px solid rgba(90,58,34,0.4)',
                }}
              >
                {h.name}
              </span>
            </button>
          )
        })}
      </div>

      {/* 右侧下注面板 */}
      <div
        className="panel"
        data-testid="bet-panel"
        style={{ position: 'absolute', right: 26, top: 88, width: 348, padding: '0 8px 10px' }}
      >
        <div style={{ textAlign: 'right', fontSize: 28 }}>👑</div>
        <div style={{ fontSize: 25, fontWeight: 800, margin: '2px 0 10px' }}>
          {t(p.lang, 'select.chooseBet')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {STAKE_PRESETS.map((v, i) => (
            <Chip
              key={v}
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i === tier && <span>🧲</span>}
                  {v}
                </span>
              }
              on={i === tier}
              onClick={() => setTier(i)}
              style={{ minWidth: 96 }}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(90,58,34,0.82)',
            color: '#ffe9c9',
            fontSize: 21,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>🧲</span>
          <span data-testid="potential-win">{t(p.lang, 'select.uwin', { n: potential })}</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 17, display: 'flex', justifyContent: 'space-between' }}>
          <span>{t(p.lang, 'select.difficulty')}</span>
          <strong data-testid="difficulty">{t(p.lang, `select.tier${tier}`)}</strong>
        </div>
        <div style={{ fontSize: 16, opacity: 0.8, marginTop: 2 }}>
          🪙 {formatMon(p.balance)} MON
        </div>
        {!affordable && (
          <div style={{ color: '#a32c17', fontWeight: 800, marginTop: 6 }}>
            {t(p.lang, 'select.insufficient')}
          </div>
        )}
      </div>

      {/* 右下：RACE */}
      <div style={{ position: 'absolute', right: 18, bottom: 22 }}>
        <StarButton
          big={p.entering ? '…' : t(p.lang, 'select.race')}
          sub={horseId === null ? t(p.lang, 'select.chooseHorse') : HORSE_PROFILES[horseId]!.name}
          disabled={horseId === null || p.entering || !affordable}
          onClick={() => horseId !== null && p.onRace(horseId, tier)}
        />
      </div>

      <div style={{ position: 'absolute', left: 24, top: 24 }}>
        <WoodButton
          zh={t(p.lang, 'select.back')}
          onClick={p.onBack}
          style={{ minWidth: 220, minHeight: 78 }}
        />
      </div>

      {p.error && (
        <div
          className="panel"
          data-testid="enter-error"
          style={{
            position: 'absolute',
            left: 520,
            bottom: 40,
            width: 560,
            padding: '4px 20px',
            textAlign: 'center',
          }}
        >
          <strong style={{ fontSize: 20 }}>{t(p.lang, 'select.enterFailed')}</strong>
        </div>
      )}
    </div>
  )
}
