import { describe, expect, test } from 'bun:test'
import { PaidSessionError, SPONSOR_QUOTA_REASON } from '../chain/paidSession.ts'
import type { PaidChoiceView } from '../race/paidDriver.ts'
import { deadlineText, deadlineView, paidChoiceText, paidErrorText, paidReasonText } from './paidText.ts'

const view = (over: Partial<PaidChoiceView>): PaidChoiceView =>
  ({ checkpoint: 1, cardId: 7, status: 'ignored', hash: null, reason: 'late', outcome: 'timeout', ...over })

describe('paid race texts', () => {
  test('an ignored choice reads as the rule reason plus how the checkpoint resolved', () => {
    expect(paidChoiceText('zh', view({}))).toBe('选择晚于截止，按超时处理')
    expect(paidChoiceText('zh', view({ reason: 'after-finish', outcome: 'none' }))).toBe('选择晚于冲线，本次选择不计入')
    expect(paidChoiceText('en', view({ reason: 'auto', outcome: 'auto' }))).toBe('Checkpoint was already automatic — counted as the automatic pick')
  })

  test('refusals map to their own messages; unknown reasons pass through', () => {
    expect(paidReasonText('zh', SPONSOR_QUOTA_REASON)).toContain('赞助额度已用完')
    expect(paidReasonText('en', 'InsufficientHouseLiquidity')).toContain('house cannot cover this tier')
    expect(paidReasonText('zh', 'CHOICE_AFTER_FINISH')).toBe('选择晚于冲线')
    expect(paidReasonText('zh', 'stubbed RPC outage')).toBe('stubbed RPC outage')
    expect(paidChoiceText('zh', view({ status: 'rejected', reason: SPONSOR_QUOTA_REASON, outcome: null }))).toContain('赞助额度已用完')
    expect(paidErrorText('zh', new PaidSessionError('house-liquidity', 'InsufficientHouseLiquidity'))).toContain('庄家资金暂时不足')
    expect(paidErrorText('en', new PaidSessionError('sponsor-quota', SPONSOR_QUOTA_REASON))).toContain('Sponsored-gas quota')
  })

  test('the settlement deadline counts whole minutes down; lost and sealed are distinct', () => {
    const open = deadlineView({ state: 'open', anchorBlock: 1n, blocksLeft: 8000n, blockMs: 344, msLeft: 2_752_000 }, 1_000)
    expect(open).toEqual({ state: 'open', at: 2_753_000 })
    expect(deadlineText('zh', open, 1_000)).toBe('请在约 45 分钟内结算，否则视为放弃')
    expect(deadlineText('zh', open, 2_700_000)).toBe('结算期限不到 1 分钟，逾期视为放弃')
    expect(deadlineText('en', deadlineView({ state: 'lost', anchorBlock: 1n }, 0), 0)).toContain('deadline has passed')
    expect(deadlineView({ state: 'sealed' }, 0)).toBeNull()
    expect(deadlineText('zh', null, 0)).toBeNull()
  })
})
