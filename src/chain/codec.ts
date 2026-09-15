/**
 * RaceResult 的紧凑编码。这份记录就是将来要进 calldata 的那一份，
 * 字段此刻定死；合约不解析它，但离线复算要能从它重放出完整比赛。
 */
import type { ChoiceReason, RaceResult } from '../race/core/types.ts'

const REASONS: ChoiceReason[] = ['picked', 'forfeited', 'timeout', 'not-reached']

export function encodeResult(r: RaceResult): string {
  const choices = r.choices
    .map((c) => [c.checkpoint, c.cardId ?? '', REASONS.indexOf(c.reason), c.refreshes.join('.')].join(':'))
    .join(',')
  return [
    'v1',
    r.raceId,
    r.seed,
    r.horseId,
    r.rank,
    r.finishTick,
    choices,
    r.gogoClicks.join('.'),
    r.endReason === 'forced-combo' ? 'c' : 'f',
  ].join('|')
}

export function decodeResult(s: string): RaceResult {
  const parts = s.split('|')
  if (parts[0] !== 'v1' || parts.length !== 9) throw new Error('bad result encoding')
  const [, raceId, seed, horseId, rank, finishTick, choices, clicks, end] = parts
  return {
    raceId: raceId!,
    seed: seed!,
    horseId: Number(horseId),
    rank: Number(rank) as 1 | 2 | 3 | 4 | 5,
    finishTick: Number(finishTick),
    choices: choices!
      .split(',')
      .filter((x) => x.length > 0)
      .map((c) => {
        const [cp, cardId, reason, refreshes] = c.split(':')
        return {
          checkpoint: Number(cp) as 0 | 1 | 2,
          cardId: cardId ? cardId : null,
          reason: REASONS[Number(reason)]!,
          refreshes: refreshes ? refreshes.split('.').map(Number) : [],
        }
      }),
    gogoClicks: clicks ? clicks.split('.').filter((x) => x.length > 0).map(Number) : [],
    endReason: end === 'c' ? 'forced-combo' : 'finished',
  }
}

/** calldata 上限：低于 1KiB */
export const MAX_RESULT_BYTES = 1024
