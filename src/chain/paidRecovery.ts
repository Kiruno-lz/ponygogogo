import { isAddressEqual, type Address } from 'viem'
import { requireContract } from './paidCalls.ts'
import { PaidSessionError, recoverPaidSession, type PaidChainDeps, type PaidSessionFacts, type SessionReader } from './paidSession.ts'

/** A session never moves contracts when a frontend points new entry at another Game. */
export type PaidSessionContext = Readonly<{ game: Address; facts: PaidSessionFacts }>

export async function recoverPaidSessions(client: SessionReader, games: readonly Address[], player: Address): Promise<PaidSessionContext[]> {
  const recovered = await Promise.all([...new Set(games)].map(async game => {
    requireContract(game)
    const facts = await recoverPaidSession(client, game, player)
    if (!facts) return null
    if (!isAddressEqual(facts.player, player)) throw new PaidSessionError('not-open', 'SESSION_PLAYER_MISMATCH', facts.sessionId)
    return Object.freeze({ game, facts })
  }))
  return recovered.filter((context): context is PaidSessionContext => context !== null)
    .sort((a, b) => a.facts.openedAt - b.facts.openedAt)
}

export function sessionChainDeps(deps: PaidChainDeps, context: Pick<PaidSessionContext, 'game'>): PaidChainDeps {
  return { ...deps, game: context.game }
}
