/**
 * 结算页。冲线封存后立即可显示，不等结算流程——
 * 比赛结果由浏览器决定，资金状态是另一条独立的进度，两者不合并成一个转圈。
 *
 * 画面按 art-src/renders/result.png 的原始坐标摆放：1620×971 的画板上，
 * 背景、奖章名牌、标题木牌、数据木纸和三个按钮都是各自的透明切片，
 * 文字层压在切片被抹空的位置上。改版面等于改这里的绝对坐标，不靠自动流式布局。
 */
import { CARD_BY_ID } from '../race/cards/pool.ts'
import { PAYOUT_TABLE, SIM_HZ, STAKE_PRESETS } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import type { RaceResult } from '../race/core/types.ts'
import { HORSE_PROFILES } from '../game/horses.ts'
import { Chip, usePress } from '../ui/Button.tsx'
import { t, type Lang } from '../ui/i18n.ts'

export type SettleStatus = 'preparing' | 'submitted' | 'settled' | 'failed'

/** 原画里奖台前沿的地平线与角色中轴，五匹马都对到这两条线上 */
const HERO_BASELINE = 719
const HERO_CENTER_X = 380
/** 五匹马统一缩到 hero-0 的 515×393 画布；每匹的实体位置不同，各自记下中轴与蹄底 */
const HERO_FRAMES = [
  { centerX: 247, bottom: 379 },
  { centerX: 263, bottom: 382 },
  { centerX: 259, bottom: 376 },
  { centerX: 262, bottom: 380 },
  { centerX: 260, bottom: 378 },
]
const HERO_W = 515
const HERO_H = 393

/** 五档奖章各一张，名次数字画在牌面上，所以这一层不再叠文字 */
const MEDAL_COUNT = 5
function medalSrc(rank: number): string {
  return `/assets/art/result/medal-${Math.min(Math.max(rank, 1), MEDAL_COUNT)}.png`
}
/** 三个卡槽在原画里的锚点：序号小页签的左缘，以及卡面图标与卡名的共同中心 */
const PICK_SLOTS = [
  { tab: 912, center: 986 },
  { tab: 1109, center: 1188 },
  { tab: 1313, center: 1395 },
]

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
  const hero = HERO_FRAMES[p.result.horseId] ?? HERO_FRAMES[0]!

  return (
    <div className="screen result-screen" data-testid="screen-result">
      <div className={`result-artboard${p.lang === 'en' ? ' en' : ''}`}>
        <img className="result-bg" src="/assets/art/result/background.webp" alt="" draggable={false} />
        <img
          className="result-hero"
          src={`/assets/art/result/hero-${p.result.horseId}.webp`}
          alt={prof.name}
          draggable={false}
          style={{
            left: HERO_CENTER_X - hero.centerX,
            top: HERO_BASELINE - hero.bottom,
            width: HERO_W,
            height: HERO_H,
          }}
        />

        <img className="result-stats-board" src="/assets/art/result/stats-board.webp" alt="" draggable={false} />
        <div className="result-rows">
          <Row label={t(p.lang, 'result.time')} value={`${(p.result.finishTick / SIM_HZ).toFixed(2)}s`} top={264} />
          <Row label={t(p.lang, 'result.stake')} value={`${stake} MON`} top={308} testId="result-stake" />
          <Row label={t(p.lang, 'result.payout')} value={`${payout} MON`} top={352} testId="result-payout" />
        </div>
        <div className="result-net-label">{t(p.lang, 'result.net')}</div>
        <div className="result-net-value" data-testid="result-net">
          {`${net >= 0 ? '+' : '−'}${Math.abs(net)} MON`}
        </div>

        <div className="result-picks-title">{t(p.lang, 'result.choices')}</div>
        {p.result.choices.map((c, i) => {
          const def = c.cardId ? CARD_BY_ID[c.cardId] : null
          const slot = PICK_SLOTS[i] ?? PICK_SLOTS[0]!
          return (
            <div
              key={c.checkpoint}
              className="result-pick"
              data-testid={`result-choice-${c.checkpoint}`}
              style={{ left: slot.tab, ['--pick-center' as string]: `${slot.center - slot.tab}px` }}
            >
              <span className="result-pick-no mono">{c.checkpoint + 1}</span>
              {def ? (
                <img className="result-pick-icon" src={`/assets/placeholder/icons/${def.art.icon}.webp`} alt="" draggable={false} />
              ) : (
                <span className="result-pick-icon result-pick-empty" aria-hidden="true" />
              )}
              <span className="result-pick-name">
                {def
                  ? def.name[p.lang]
                  : t(
                      p.lang,
                      c.reason === 'not-reached'
                        ? 'result.notReached'
                        : c.reason === 'timeout'
                          ? 'result.timeout'
                          : 'result.forfeited',
                    )}
              </span>
            </div>
          )
        })}

        {/* 资金状态独立于名次：木纸上只盖一枚短印章，失败的原委与重试放到按钮行下方 */}
        <div className="result-settle" data-testid="settle-status">
          <span className={`result-settle-stamp${p.settle === 'failed' ? ' failed' : ''}`}>
            {p.settle === 'settled'
              ? t(p.lang, 'result.settled')
              : p.settle === 'failed'
                ? t(p.lang, 'result.settleFailedShort')
                : t(p.lang, 'result.settlingShort')}
          </span>
          {p.settle === 'failed' && (
            <span className="result-settle-retry">
              <span className="result-settle-why">{t(p.lang, 'result.settleFailed')}</span>
              <Chip label={t(p.lang, 'result.settleRetry')} onClick={p.onRetrySettle} style={{ fontSize: 22 }} />
            </span>
          )}
        </div>

        <img className="result-nameplate" src="/assets/art/result/nameplate.webp" alt="" draggable={false} />
        <img
          className="result-medal-art"
          src={medalSrc(p.result.rank)}
          alt={`${t(p.lang, 'result.rank')} ${p.result.rank}`}
          draggable={false}
        />
        {/* 名次已经画在奖章上，这里只留一个供读屏与测试取值的节点 */}
        <span className="sr-only" data-testid="result-rank">{p.result.rank}</span>
        <span className="result-name">{prof.name}</span>
        <span className="result-rank-line">
          <span className="result-rank-label">{t(p.lang, 'result.rank')}</span>
          <span className="result-rank-total mono">/ {HORSE_PROFILES.length}</span>
        </span>
        {combo && (
          <span className="result-combo" data-testid="result-combo">
            ✦ {t(p.lang, 'result.combo')}
          </span>
        )}

        {/* 标题木牌整块无字，主副标题在这里排版 */}
        <img className="result-header" src="/assets/art/result/header.webp" alt="" draggable={false} />
        <span className="result-title">{t(p.lang, 'result.title')}</span>
        {/* 英文时主副标题说的是同一句话，只留主标题 */}
        {p.lang === 'zh' && <span className="result-title-en">RACE COMPLETE</span>}

        <ArtButton art="home" className="result-btn-home" label={t(p.lang, 'result.home')} onClick={p.onHome} />
        <ArtButton
          art="share"
          className="result-btn-share"
          label={p.shared ? t(p.lang, 'result.shared') : t(p.lang, 'result.share')}
          onClick={p.onShare}
        />
        <ArtButton art="again" className="result-btn-again" label={t(p.lang, 'result.again')} onClick={p.onAgain} />
      </div>
    </div>
  )
}

function Row({ label, value, top, testId }: { label: string; value: string; top: number; testId?: string }) {
  return (
    <div className="result-row" style={{ top }}>
      <span className="result-row-label">{label}</span>
      <span className="result-row-value mono" data-testid={testId}>
        {value}
      </span>
    </div>
  )
}

/** 木牌与星形都是带 alpha 的整块原画，按钮本身不画任何底色，悬浮滤镜才不会溢出轮廓 */
function ArtButton({ art, className, label, onClick }: {
  art: 'home' | 'share' | 'again'
  className: string
  label: string
  onClick: () => void
}) {
  const { pressed, handlers } = usePress(onClick)
  return (
    <button type="button" className={`btn ${className}${pressed ? ' pressed' : ''}`} {...handlers}>
      <img src={`/assets/art/result/button-${art}.webp`} alt="" draggable={false} />
      <span className="lbl">{label}</span>
    </button>
  )
}
