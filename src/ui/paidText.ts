/**
 * 有奖比赛的界面文案：错误码 → 说明、被忽略的选择、结算期限。纯函数，比赛页、结算页与恢复窗口共用。
 *
 * 失败原因一律先查已知码（赞助额度用完、庄家流动性不足、选择预检码……），查不到才原样带出，所以同一条
 * 链上错误在入场、选牌与结算三处读起来一样。
 */
import { deadlineMinutes, type SettleDeadline } from '../chain/settleDeadline.ts'
import { PaidSessionError, SPONSOR_QUOTA_REASON } from '../chain/paidSession.ts'
import type { PaidChoiceView } from '../race/paidDriver.ts'
import { t, type Lang } from './i18n.ts'

/** 失败原因里可以直接翻译的码：错误名、赞助额度，以及 checkPaidChoice 的预检码（与 CHOICE_INVALID 原因同义） */
const REASON_KEYS: Readonly<Record<string, string>> = {
  [SPONSOR_QUOTA_REASON]: 'paid.err.sponsor-quota',
  InsufficientHouseLiquidity: 'paid.err.house-liquidity',
  EntryPaused: 'paid.err.entry-paused',
  // 结算时只会因所需锚过窗而读不到（开场与选择块都早于冲线）：会话只能判负
  AnchorUnavailable: 'paid.deadline.lost',
  CHOICE_NOT_OPEN: 'paid.invalid.not-opened',
  CHOICE_OUTSIDE_WINDOW: 'paid.invalid.late',
  CHOICE_AFTER_FINISH: 'paid.invalid.after-finish',
  NO_REFRESH_CREDIT: 'paid.invalid.no-credit',
  INVALID_REFRESH: 'paid.invalid.bad-slot',
  DECK_EXHAUSTED: 'paid.invalid.exhausted',
  CARD_NOT_OFFERED: 'paid.invalid.not-offered',
}

export function paidReasonText(lang: Lang, reason: string): string {
  const key = REASON_KEYS[reason]
  return key ? t(lang, key) : reason
}

export function paidErrorText(lang: Lang, err: unknown): string {
  if (err instanceof PaidSessionError) return t(lang, `paid.err.${err.code}`, { detail: paidReasonText(lang, err.detail) })
  const detail = err instanceof Error ? err.message : String(err)
  return t(lang, 'paid.err.unknown', { detail: detail.slice(0, 160) })
}

/** 比赛页左下角的选择状态行；included 走 tx 链接，不在这里。 */
export function paidChoiceText(lang: Lang, choice: PaidChoiceView): string {
  if (choice.status === 'ignored') {
    return t(lang, 'paid.choice.ignored', {
      why: t(lang, `paid.invalid.${choice.reason ?? 'not-opened'}`),
      outcome: t(lang, `paid.outcome.${choice.outcome ?? 'none'}`),
    })
  }
  return t(lang, `paid.choice.${choice.status}`, { k: choice.checkpoint, reason: paidReasonText(lang, choice.reason ?? '') })
}

/** 结算期限的界面形态：open 带 Date.now 轴上的截止时刻；所需锚都已封存（没有期限）为 null */
export type DeadlineView = { state: 'open'; at: number } | { state: 'lost' } | null

export function deadlineView(d: SettleDeadline | null, nowMs: number): DeadlineView {
  if (d === null || d.state === 'sealed') return null
  return d.state === 'lost' ? { state: 'lost' } : { state: 'open', at: nowMs + d.msLeft }
}

/** 「约 N 分钟内结算，否则视为放弃」；分钟向下取整，不到 1 分钟单独一句。 */
export function deadlineText(lang: Lang, d: DeadlineView, nowMs: number): string | null {
  if (d === null) return null
  if (d.state === 'lost') return t(lang, 'paid.deadline.lost')
  const minutes = deadlineMinutes(d.at - nowMs)
  return minutes > 0 ? t(lang, 'paid.deadline.minutes', { n: minutes }) : t(lang, 'paid.deadline.soon')
}
