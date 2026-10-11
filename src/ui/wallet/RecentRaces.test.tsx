import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Hex } from 'viem'
import { MON } from '../../chain/amount.ts'
import type { HistorySession } from '../../chain/history.ts'
import { RecentRacesView } from './RecentRaces.tsx'

const session = (id: number, over: Partial<HistorySession>): HistorySession => ({
  sessionId: `0x${id.toString(16).padStart(64, '0')}` as Hex, horseId: 2, roster: [0,1,2,3,4], stake: MON * 3n / 10n, state: 'settled',
  openedAt: 1_790_000_000, openedBlock: 1n, openTx: `0x${'11'.repeat(32)}`, choices: [], settlementRank: 1, rawRank: 1,
  payout: MON * 9n / 10n, net: MON * 6n / 10n, forfeitReason: null, closedAt: 1_790_000_100, closeTx: null, ...over,
  finishTime: over.finishTime === undefined ? [54156, 57473, 60923, 51058, 59953] : over.finishTime,
})

describe('recent races in the wallet', () => {
  test('hidden entirely when the indexer is not configured', () => {
    expect(renderToStaticMarkup(<RecentRacesView lang="zh" result={{ status: 'not-configured' }} />)).toBe('')
  })

  test('one row per session: stake, settlement rank or forfeit, finish time; keeps all rows beyond the viewport', () => {
    const sessions = [
      session(1, {}),
      session(2, { state: 'forfeited', finishTime: null, settlementRank: null, payout: 0n, net: -MON, stake: MON, forfeitReason: 'anchor-lost' }),
      session(3, { state: 'open', finishTime: null, settlementRank: null, payout: null, net: null }),
      ...Array.from({ length: 60 }, (_, i) => session(i + 4, {})),
    ]
    const html = renderToStaticMarkup(
      <RecentRacesView lang="zh" result={{ status: 'ok', source: 'envio-read-model', sessions, indexedBlock: 9n, ready: true }} />,
    )
    expect(html.match(/data-testid="wallet-history-row"/g)).toHaveLength(63)
    expect(html).toContain('0.3 MON')
    expect(html).toContain('第 1 名')
    expect(html).toContain('60.92 s')
    expect(html).toContain('已判负')
    expect(html).not.toContain('-1.00')
    expect(html).toContain('进行中')
  })

  test('transaction sits after the horse, settlement rank differs from physical rank, and header totals gross returns', () => {
    const tx = `0x1234${'a'.repeat(56)}abcd` as Hex
    const html = renderToStaticMarkup(<RecentRacesView lang="zh" result={{ status: 'ok', source: 'envio-read-model',
      sessions: [session(1, { settlementRank: 2, rawRank: 1, closeTx: tx }), session(2, { payout: MON })], indexedBlock: 9n, ready: true }} />)
    expect(html).toContain('0x1234...abcd')
    expect(html).toContain(`href="https://testnet.monadexplorer.com/tx/${tx}"`)
    expect(html.indexOf('0x1234...abcd')).toBeLessThan(html.indexOf('0.3 MON'))
    expect(html).toContain('第 2 名')
    expect(html).toContain('累积返还')
    expect(html).toContain('1.9 MON')
  })

  test('loading and errors say so without inventing numbers', () => {
    expect(renderToStaticMarkup(<RecentRacesView lang="en" result={null} />)).toContain('Loading')
    const failed = renderToStaticMarkup(<RecentRacesView lang="en" result={{ status: 'error', code: 'network', detail: 'x' }} />)
    expect(failed).toContain('wallet-history-error')
    expect(failed).not.toContain('MON')
  })
})
