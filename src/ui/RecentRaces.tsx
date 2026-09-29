/**
 * 钱包面板里的「最近战绩」：Envio 读模型里该游戏账户最近几场有奖比赛（chain/history.ts）。
 * 只作展示——可能滞后或被重组回滚，余额与会话状态一律以面板上方的 RPC 读数为准。索引器未配置时整块不出现
 * （WalletModal 按 ENVIO_GRAPHQL_URL 决定是否挂载，未配置时不会闪一下「读取中」）。
 */
import { useEffect, useState } from 'react'
import { formatMon, formatMonTrim } from '../chain/amount.ts'
import { fetchRecentSessions, type HistoryResult, type HistorySession } from '../chain/history.ts'
import { HORSE_PROFILES } from '../game/horses.ts'
import { t, type Lang } from './i18n.ts'

const ROWS = 5

function when(sec: number): string {
  const d = new Date(sec * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

function outcome(lang: Lang, s: HistorySession): string {
  if (s.state === 'forfeited') return t(lang, 'wallet.historyForfeited')
  if (s.state === 'open') return t(lang, 'wallet.historyOpen')
  return t(lang, 'wallet.historyRank', { rank: s.settlementRank ?? '—' })
}

function net(s: HistorySession): string {
  if (s.net === null) return '—'
  return `${s.net > 0n ? '+' : ''}${formatMon(s.net, 2)}`
}

/** 纯展示：loading 为 null；未配置时不渲染任何东西。 */
export function RecentRacesView({ lang, result }: { lang: Lang; result: HistoryResult | null }) {
  if (result?.status === 'not-configured') return null
  return (
    <section className="wallet-history" data-testid="wallet-history" aria-label={t(lang, 'wallet.history')}>
      <h3>{t(lang, 'wallet.history')}</h3>
      {result === null ? (
        <p className="wallet-muted">{t(lang, 'wallet.historyLoading')}</p>
      ) : result.status === 'error' ? (
        <p className="wallet-muted" data-testid="wallet-history-error">{t(lang, 'wallet.historyError')}</p>
      ) : result.sessions.length === 0 ? (
        <p className="wallet-muted">{t(lang, 'wallet.historyEmpty')}</p>
      ) : (
        <ol>
          {result.sessions.slice(0, ROWS).map((s) => (
            <li key={s.sessionId} data-testid="wallet-history-row" data-state={s.state}>
              <span className="mono">{when(s.openedAt)}</span>
              <span>{HORSE_PROFILES[s.horseId]?.name ?? `#${s.horseId + 1}`}</span>
              <span className="mono">{formatMonTrim(s.stake)} MON</span>
              <span>{outcome(lang, s)}</span>
              <span className="mono">{net(s)}</span>
            </li>
          ))}
        </ol>
      )}
      <small>{t(lang, 'wallet.historyHint')}</small>
    </section>
  )
}

/** 打开面板时读一次；换账户重读。 */
export function RecentRaces({ lang, player }: { lang: Lang; player: string }) {
  const [state, setState] = useState<{ player: string; result: HistoryResult } | null>(null)
  useEffect(() => {
    let live = true
    void fetchRecentSessions(player, { limit: ROWS }).then((result) => {
      if (live) setState({ player, result })
    })
    return () => {
      live = false
    }
  }, [player])
  return <RecentRacesView lang={lang} result={state?.player === player ? state.result : null} />
}
