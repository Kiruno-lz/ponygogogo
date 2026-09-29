/**
 * 登录后发现链上还有未完结的有奖会话：继续观看（按规范时间落到当前时刻），或在冲线之后直接去结算。
 * 刷新、关页都不改变已上链的选择；这里只读链上事实，不重发任何交易。
 * 没有退款（会话协议 v2）：窗口里写明结算期限，逾期视为放弃、返还 0。
 */
import { WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'
import { deadlineText, type DeadlineView } from './paidText.ts'
import { StageDialog } from './StageDialog.tsx'
import { useNow } from './useNow.ts'

export function PaidResumeModal({ lang, stakeLabel, deadline, busy, canSettle, onContinue, onSettle, onLater }: {
  lang: Lang
  /** 档位文案，如 0.3 */
  stakeLabel: string
  deadline: DeadlineView
  busy: boolean
  /** 链上时间已越过玩家冲线：可以直接结算 */
  canSettle: boolean
  onContinue: () => void
  onSettle: () => void
  onLater: () => void
}) {
  const now = useNow(15_000, deadline?.state === 'open')
  const deadlineLine = deadlineText(lang, deadline, now)
  return (
    // 进行中不可关：Escape、点遮罩与「稍后」按钮同一条规则
    <StageDialog label={t(lang, 'resume.title')} testId="paid-resume" busy={busy} onDismiss={onLater}>
      <div className="panel wallet-modal wallet-dialog">
        <h2 className="h-title">{t(lang, 'resume.title')}</h2>
        <p className="wallet-dialog-hint">{t(lang, 'resume.body', { stake: stakeLabel })}</p>
        {deadlineLine && (
          <p className="wallet-dialog-hint wallet-deadline" data-testid="paid-resume-deadline" data-state={deadline?.state}>
            {deadlineLine}
          </p>
        )}
        <div className="wallet-dialog-actions">
          <WoodButton zh={t(lang, 'resume.continue')} onClick={onContinue} disabled={busy} style={{ minWidth: 260 }} />
          {canSettle && (
            <button type="button" className="chip" data-testid="paid-resume-settle" disabled={busy} onClick={onSettle}>
              {t(lang, 'resume.settle')}
            </button>
          )}
          <button type="button" className="chip" data-testid="paid-resume-later" disabled={busy} onClick={onLater}>
            {t(lang, 'resume.later')}
          </button>
        </div>
      </div>
    </StageDialog>
  )
}
