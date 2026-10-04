import { cardIconUrl } from '../race/cards/iconUrl.ts'
/**
 * 结算页，承接两种比赛：
 * - 免费本地试玩：名次由共享求时器在本地算出，不上链、不计奖金，页面上明确标成「本地试玩」，
 *   不出现下注、返还或盈亏数字。
 * - 有奖比赛（`paid`）：冲线时先显示浏览器预览名次并标「待链上验证」；名次、返还、净盈亏与三次选择
 *   （`acquired`）只取 `SessionSettled`。印章写结算中 / 已结算 / 结算失败 / 已判负；结算交易提交后显示 tx 与
 *   浏览器链接；失败的完整说明、结算期限与「重试结算」放在按钮行下方，不挤进印章。没有退款：判负返还 0。
 *
 * 1620×971 画板上的透明素材保持原始宽高比；文字与素材一起布局。
 * 分享海报使用独立空白素材，动态内容与本页共用比赛和链上结算结果。
 */
import { useState } from 'react'
import { SharePosterDialog } from './SharePosterDialog.tsx'
import type { Hex } from 'viem'
import { formatMon } from '../chain/amount.ts'
import { explorerTxUrl } from '../chain/network.ts'
import { paidCardDef } from '../race/cards/paidCards.ts'
import { SIM_HZ } from '../race/core/constants.ts'
import type { RaceResult } from '../race/core/types.ts'
import { ponyById, ponyIdAt } from '../game/ponyCatalog.ts'
import { usePress } from '../ui/Button.tsx'
import { t, type Lang } from '../ui/i18n.ts'
import { deadlineText, type DeadlineView } from '../ui/paidText.ts'
import { useNow } from '../ui/useNow.ts'

/** 奖台踏面与角色中轴，五匹马按各自蹄底对齐 */
const HERO_BASELINE = 739
const HERO_CENTER_X = 380
const HERO_W = 515
const HERO_H = 393
const HERO_SCALE = 1.12

/** 五档奖章各一张，名次数字画在牌面上，所以这一层不再叠文字 */
const MEDAL_COUNT = 5
function medalSrc(rank: number): string {
  return `/assets/art/result/medal-${Math.min(Math.max(rank, 1), MEDAL_COUNT)}.webp`
}
/** 三个卡槽在原画里的锚点：序号小页签的左缘，以及卡面图标与卡名的共同中心 */
const PICK_SLOTS = [
  { tab: 912, center: 986 },
  { tab: 1109, center: 1188 },
  { tab: 1313, center: 1395 },
]

export type PaidSettlePhase = 'waiting' | 'pending' | 'settled' | 'failed' | 'forfeited'

/** 有奖结算页的全部链上相关展示；金额一律 wei。 */
export interface PaidResultView {
  stakeLabel: string
  stake: bigint
  /** 浏览器预览的结算名次（待链上验证） */
  previewRank: number
  phase: PaidSettlePhase
  /** 已提交的结算交易（可能尚未入块） */
  txHash: Hex | null
  /** 等待中的说明或失败原因 */
  detail: string | null
  settlement: { rank: number; payout: bigint } | null
  /** 链上名次与预览不一致 */
  mismatch: boolean
  /** 结算期限（冲线后、结算前显示） */
  deadline: DeadlineView
  /** 每个检查点在没有卡时的说明（断卡、自动、冲线时关闭等） */
  choiceNotes: (string | null)[]
  onRetry: () => void
}

export interface ResultScreenProps {
  lang: Lang
  result: RaceResult
  paid?: PaidResultView
  onAgain: () => void
  onHome: () => void
  choiceNotes?: (string | null)[]
}

export function ResultScreen(p: ResultScreenProps) {
  const [shareOpen, setShareOpen] = useState(false)
  const ponyId = ponyIdAt(p.result.roster, p.result.horseId)
  const prof = ponyById(ponyId)
  const combo = p.result.endReason === 'forced-combo'
  const hero = prof.renderSpec.resultFooting
  const paid = p.paid ?? null
  const settled = paid?.settlement ?? null
  const forfeited = paid?.phase === 'forfeited'
  const rank = settled ? settled.rank : p.result.rank
  const lookup = paidCardDef
  const txUrl = paid?.txHash ? explorerTxUrl(paid.txHash) : null
  const verifyText = !paid ? '' : settled
    ? t(p.lang, 'result.chainRank', { rank: settled.rank })
    : t(p.lang, forfeited ? 'result.previewRankForfeited' : 'result.previewRank', { rank: paid.previewRank })
  /** 结算未完成（或与预览不一致）时，按钮行下方另起一行说明；名次说明并入这一行，避免两行叠在一起 */
  const showDetail = paid !== null && (paid.phase !== 'settled' || paid.mismatch)
  const deadline = paid && !settled && !forfeited ? paid.deadline : null
  const now = useNow(15_000, deadline?.state === 'open')
  const deadlineLine = deadlineText(p.lang, deadline, now)
  /** 判负返还 0（下注已转入庄家流动性） */
  const payout = settled ? settled.payout : forfeited ? 0n : null

  return (
    <div className="screen result-screen" data-testid="screen-result">
      <div className={`result-artboard${p.lang === 'en' ? ' en' : ''}`}>
        <img className="result-bg" src="/assets/art/result/background.webp" alt="" draggable={false} />
        <img
          className="result-hero"
          src={`/assets/art/result/hero-${ponyId}.webp`}
          alt={prof.name}
          draggable={false}
          style={{
            left: HERO_CENTER_X - hero.centerX * HERO_SCALE,
            top: HERO_BASELINE - hero.bottom * HERO_SCALE,
            width: HERO_W * HERO_SCALE,
            height: HERO_H * HERO_SCALE,
          }}
        />

        <img className="result-stats-board" src="/assets/art/result/stats-board.webp" alt="" draggable={false} />
        <div className="result-rows">
          <Row label={t(p.lang, 'result.time')} value={`${(p.result.finishTick / SIM_HZ).toFixed(2)}s`} top={264} />
          {paid ? (
            <>
              <Row label={t(p.lang, 'result.mode')} value={t(p.lang, 'result.paid', { stake: paid.stakeLabel })} top={308} testId="result-mode" />
              <Row
                label={t(p.lang, 'result.payout')}
                value={payout !== null ? `${formatMon(payout, 4)} MON` : t(p.lang, 'result.pendingValue')}
                top={352}
                testId="result-prize"
              />
            </>
          ) : (
            <>
              <Row label={t(p.lang, 'result.mode')} value={t(p.lang, 'result.practice')} top={308} testId="result-mode" />
              <Row label={t(p.lang, 'result.prize')} value={t(p.lang, 'result.noPrize')} top={352} testId="result-prize" />
            </>
          )}
        </div>
        {/* 原净盈亏的标签与数值两格：中间压着木纸上的金币，文字分列两侧 */}
        {paid ? (
          <div className="result-practice" data-testid="result-net">
            <span className="result-practice-label">{t(p.lang, 'result.net')}</span>
            <span className="result-practice-value mono" data-testid="result-net-value">
              {payout !== null ? `${payout >= paid.stake ? '+' : ''}${formatMon(payout - paid.stake, 4)}` : '—'}
            </span>
          </div>
        ) : (
          <div className="result-practice" data-testid="result-practice-note">
            <span className="result-practice-label">{t(p.lang, 'result.practiceLabel')}</span>
            <span className="result-practice-value">{t(p.lang, 'result.practiceValue')}</span>
          </div>
        )}

        <div className="result-picks-title">{t(p.lang, 'result.choices')}</div>
        {p.result.choices.map((c, i) => {
          const def = c.cardId ? lookup(c.cardId) ?? null : null
          const note = paid?.choiceNotes[i] ?? p.choiceNotes?.[i] ?? null
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
                <img className="result-pick-icon" src={cardIconUrl(def.art.icon)} alt="" draggable={false} />
              ) : (
                <span className="result-pick-icon result-pick-empty" aria-hidden="true" />
              )}
              <span className="result-pick-name">
                {def
                  ? def.name[p.lang]
                  : note ?? t(
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

        {/* 木纸上原有的空心印章框：试玩只盖「本地试玩」；有奖盖结算状态 */}
        {paid ? (
          <span className={`result-settle-stamp stamp-${paid.phase}`} data-testid="settle-stamp" data-phase={paid.phase}>
            {t(p.lang, `result.stamp.${paid.phase}`)}
          </span>
        ) : (
          <span className="result-settle-stamp" data-testid="practice-stamp">{t(p.lang, 'result.practiceStamp')}</span>
        )}
        {paid && txUrl && (
          <a className="result-tx" data-testid="settle-tx" href={txUrl} target="_blank" rel="noreferrer">
            {t(p.lang, 'result.tx')} {paid.txHash!.slice(0, 6)}…{paid.txHash!.slice(-4)}
          </a>
        )}

        <img className="result-nameplate" src="/assets/art/result/nameplate.webp" alt="" draggable={false} />
        <img
          className="result-medal-art"
          src={medalSrc(rank)}
          alt={`${t(p.lang, 'result.rank')} ${rank}`}
          draggable={false}
        />
        {/* 名次已经画在奖章上，这里只留一个供读屏与测试取值的节点 */}
        <span className="sr-only" data-testid="result-rank">{rank}</span>
        <span className="result-name">{prof.name}</span>
        <span className="result-rank-line">
          <span className="result-rank-label">{t(p.lang, 'result.rank')}</span>
          <span className="result-rank-total mono">/ 5</span>
        </span>
        {combo && !paid && (
          <span className="result-combo" data-testid="result-combo">
            ✦ {t(p.lang, 'result.combo')}
          </span>
        )}
        {paid && !showDetail && (
          <span className="result-combo result-verify" data-testid="result-verify">{verifyText}</span>
        )}

        {/* 标题木牌整块无字，主副标题在这里排版 */}
        <div className="result-heading">
          <img className="result-header" src="/assets/art/result/header.webp" alt="" draggable={false} />
          <span className="result-title">{t(p.lang, 'result.title')}</span>
          {/* 英文时主副标题说的是同一句话，只留主标题 */}
          {p.lang === 'zh' && <span className="result-title-en">RACE COMPLETE</span>}
        </div>

        <ArtButton art="home" className="result-btn-home" label={t(p.lang, 'result.home')} onClick={p.onHome} />
        <ArtButton
          art="share"
          className="result-btn-share"
          label={t(p.lang, 'result.share')}
          onClick={() => setShareOpen(true)}
        />
        <ArtButton art="again" className="result-btn-again" label={t(p.lang, 'result.again')} onClick={p.onAgain} />

        {/* 按钮行下方：结算进度、失败说明与重试 */}
        {paid && showDetail && (
          <div className="result-settle-detail" data-testid="settle-detail">
            <div className="result-settle-line">
              <span className="result-settle-verify" data-testid="result-verify">{verifyText}</span>
              <span className="result-settle-text">
                {paid.phase === 'failed'
                  ? t(p.lang, 'result.settleFailed', { reason: paid.detail ?? '' })
                  : paid.phase === 'waiting'
                    ? t(p.lang, 'result.settleWaiting')
                    : paid.phase === 'pending'
                      ? paid.detail ?? t(p.lang, 'result.settleSubmitted')
                      : paid.phase === 'forfeited'
                        ? t(p.lang, 'result.forfeitedDetail')
                        : t(p.lang, 'result.mismatch')}
              </span>
              {paid.phase === 'failed' && (
                <button type="button" className="chip" data-testid="settle-retry" onClick={paid.onRetry}>
                  {t(p.lang, 'result.retry')}
                </button>
              )}
            </div>
            {deadlineLine && (
              <span className="result-settle-deadline" data-testid="settle-deadline" data-state={deadline?.state}>{deadlineLine}</span>
            )}
          </div>
        )}
      </div>
      {shareOpen && <SharePosterDialog lang={p.lang} result={p.result} paid={p.paid} onClose={() => setShareOpen(false)} />}
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
    <button type="button" data-testid={className} className={`btn ${className}${pressed ? ' pressed' : ''}`} {...handlers}>
      <img src={`/assets/art/result/button-${art}.webp`} alt="" draggable={false} />
      <span className="lbl">{label}</span>
    </button>
  )
}
