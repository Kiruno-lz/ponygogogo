import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Hex } from 'viem'
import { MON } from '../chain/amount.ts'
import type { HistorySession } from '../chain/history.ts'
import { RecentRacesView } from './RecentRaces.tsx'

const session = (id: number, over: Partial<HistorySession>): HistorySession => ({
  sessionId: `0x${id.toString(16).padStart(64, '0')}` as Hex, horseId: 2, stake: MON * 3n / 10n, state: 'settled',
  openedAt: 1_790_000_000, openedBlock: 1n, openTx: `0x${'11'.repeat(32)}`, choices: [], settlementRank: 1, rawRank: 1,
  payout: MON * 9n / 10n, net: MON * 6n / 10n, forfeitReason: null, closedAt: 1_790_000_100, closeTx: null, ...over,
})

describe('recent races in the wallet', () => {
  test('hidden entirely when the indexer is not configured', () => {
    expect(renderToStaticMarkup(<RecentRacesView lang="zh" result={{ status: 'not-configured' }} />)).toBe('')
  })

  test('one row per session: stake, rank or forfeit, net; at most five rows', () => {
    const sessions = [
      session(1, {}),
      session(2, { state: 'forfeited', settlementRank: null, payout: 0n, net: -MON, stake: MON, forfeitReason: 'anchor-lost' }),
      session(3, { state: 'open', settlementRank: null, payout: null, net: null }),
      ...[4, 5, 6].map((i) => session(i, {})),
    ]
    const html = renderToStaticMarkup(
      <RecentRacesView lang="zh" result={{ status: 'ok', source: 'envio-read-model', sessions, indexedBlock: 9n, ready: true }} />,
    )
    expect(html.match(/data-testid="wallet-history-row"/g)).toHaveLength(5)
    expect(html).toContain('0.3 MON')
    expect(html).toContain('第 1 名')
    expect(html).toContain('+0.60')
    expect(html).toContain('已判负')
    expect(html).toContain('-1.00')
    expect(html).toContain('进行中')
  })

  test('loading and errors say so without inventing numbers', () => {
    expect(renderToStaticMarkup(<RecentRacesView lang="en" result={null} />)).toContain('Loading')
    const failed = renderToStaticMarkup(<RecentRacesView lang="en" result={{ status: 'error', code: 'network', detail: 'x' }} />)
    expect(failed).toContain('wallet-history-error')
    expect(failed).not.toContain('MON')
  })
})
