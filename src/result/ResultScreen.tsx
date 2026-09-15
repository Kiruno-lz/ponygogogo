/**
 * 结算页。冲线封存后立即可显示，不等结算流程——
 * 比赛结果由浏览器决定，资金状态是另一条独立的进度，两者不合并成一个转圈。
 */
import { CARD_BY_ID } from '../race/cards/pool.ts'
import { PAYOUT_TABLE, SIM_HZ, STAKE_PRESETS } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import type { RaceResult } from '../race/core/types.ts'
import { Card } from '../cards/Card.tsx'
import { HORSE_PROFILES } from '../game/horses.ts'
import { StarButton, WoodButton, Chip } from '../ui/Button.tsx'
import { t, type Lang } from '../ui/i18n.ts'
import { PonyPortrait } from '../ui/PonyPortrait.tsx'

export type SettleStatus = 'preparing' | 'submitted' | 'settled' | 'failed'

export interface ResultScreenProps {
  lang: Lang
  result: RaceResult
  stakeTier: number
  settle: SettleStatus
  onRetrySettle: () => void
  onAgain: () => void
  onHome: () => void
  onShare: () => void
  shared: boolean
}

export function ResultScreen(p: ResultScreenProps) {
  const stake = STAKE_PRESETS[p.stakeTier]!
  const payout = (stake * PAYOUT_TABLE[p.result.rank - 1]!) / FP
  const net = payout - stake
  const prof = HORSE_PROFILES[p.result.horseId]!
  const combo = p.result.endReason === 'forced-combo'

  return (
    <div
      className="screen"
      data-testid="screen-result"
      style={{
        background: 'linear-gradient(#f7e9d8,#e2c6a9)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
      }}
    >
      <h1 className="h-title" style={{ margin: 0, fontSize: 46 }}>
        {p.result.rank === 1 ? '🏆 ' : ''}
        {t(p.lang, 'result.title')}
      </h1>

      <div style={{ display: 'flex', gap: 26, alignItems: 'center' }}>
        <div className="panel" style={{ width: 290, height: 320, display: 'grid', placeItems: 'center', padding: 0 }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <PonyPortrait horseId={p.result.horseId} width={176} />
            <div
              style={{
                fontSize: 21,
                fontWeight: 800,
                marginTop: 2,
                padding: '2px 16px',
                borderRadius: 9,
                background: 'rgba(249,199,79,0.5)',
                border: '2px solid rgba(90,58,34,0.35)',
              }}
            >
              {prof.name}
            </div>
          </div>
        </div>

        <div className="panel" style={{ width: 430, height: 320, padding: '2px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ fontSize: 20 }}>{t(p.lang, 'result.rank')}</span>
            <span
              className="h-title mono"
              data-testid="result-rank"
              style={{ fontSize: 74, lineHeight: 1, color: p.result.rank === 1 ? '#d98f12' : '#57250c' }}
            >
              {p.result.rank}
            </span>
            <span style={{ fontSize: 26 }}>{p.result.rank === 1 ? '🏆' : '/ 5'}</span>
          </div>
          {combo && (
            <div data-testid="result-combo" style={{ color: '#b5451f', fontWeight: 900, fontSize: 22 }}>
              ✦ {t(p.lang, 'result.combo')}
            </div>
          )}
          <Line label={t(p.lang, 'result.time')} value={`${(p.result.finishTick / SIM_HZ).toFixed(2)}s`} />
          <Line label={t(p.lang, 'result.stake')} value={`${stake} MON`} testId="result-stake" />
          <Line label={t(p.lang, 'result.payout')} value={`${payout} MON`} testId="result-payout" />
          <Line
            label={t(p.lang, 'result.net')}
            value={`${net >= 0 ? '+' : ''}${net} MON`}
            strong
            testId="result-net"
          />
          <div style={{ height: 6 }} />
        </div>

        <div className="panel" style={{ width: 430, height: 320, padding: '2px 18px' }}>
          <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>
            {t(p.lang, 'result.choices')}
          </div>
          {p.result.choices.map((c) => {
            const def = c.cardId ? CARD_BY_ID[c.cardId] : null
            return (
              <div
                key={c.checkpoint}
                data-testid={`result-choice-${c.checkpoint}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  height: 82,
                  borderBottom: '2px solid rgba(120,80,50,0.18)',
                }}
              >
                <span className="mono" style={{ width: 22, opacity: 0.7 }}>
                  {c.checkpoint + 1}
                </span>
                {def ? (
                  <>
                    <Card def={def} lang={p.lang} size="hud" />
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        lineHeight: 1.2,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {def.name[p.lang]}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.7 }}>
                    {t(
                      p.lang,
                      c.reason === 'not-reached'
                        ? 'result.notReached'
                        : c.reason === 'timeout'
                          ? 'result.timeout'
                          : 'result.forfeited',
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 资金状态独立于名次 */}
      <div
        data-testid="settle-status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 19,
          fontWeight: 700,
          color: p.settle === 'failed' ? '#a32c17' : '#57250c',
        }}
      >
        {p.settle === 'settled' ? '✅ ' + t(p.lang, 'result.settled') : null}
        {p.settle === 'failed' ? '⚠️ ' + t(p.lang, 'result.settleFailed') : null}
        {p.settle !== 'settled' && p.settle !== 'failed' ? '⏳ ' + t(p.lang, 'result.settling') : null}
        {p.settle === 'failed' && (
          <Chip
            label={t(p.lang, 'result.settleRetry')}
            onClick={p.onRetrySettle}
            style={{ fontSize: 17 }}
          />
        )}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginTop: 2 }}>
        <WoodButton
          zh={t(p.lang, 'result.home')}
          onClick={p.onHome}
          style={{ minWidth: 280, minHeight: 84 }}
        />
        <WoodButton
          zh={p.shared ? t(p.lang, 'result.shared') : t(p.lang, 'result.share')}
          icon="🖼️"
          onClick={p.onShare}
          style={{ minWidth: 330, minHeight: 84 }}
        />
        <StarButton
          big={t(p.lang, 'result.again')}
          onClick={p.onAgain}
          style={{ minWidth: 300, minHeight: 190 }}
        />
      </div>
    </div>
  )
}

function Line({
  label,
  value,
  strong,
  testId,
}: {
  label: string
  value: string
  strong?: boolean
  testId?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: strong ? 22 : 19,
        fontWeight: strong ? 900 : 600,
        padding: '2px 0',
        borderBottom: '2px solid rgba(120,80,50,0.18)',
      }}
    >
      <span>{label}</span>
      <span className="mono" data-testid={testId}>
        {value}
      </span>
    </div>
  )
}
