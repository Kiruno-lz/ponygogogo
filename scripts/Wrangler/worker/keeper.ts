import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'
import { createKeeper, formatAction, type KeeperCheckpoint } from '../../../src/chain/keeper.ts'

type Statement = {
  bind(...values: (string | number)[]): Statement
  first<T>(): Promise<T | null>
  run(): Promise<{ meta: { changes: number } }>
}
export type KeeperEnv = {
  COLLECTION_DB: { prepare(sql: string): Statement }
  KEEPER_RPC_URL?: string
  KEEPER_GAME_ADDRESS?: string
  KEEPER_FROM_BLOCK?: string
  KEEPER_PRIVATE_KEY?: string
}

/** D1 preserves scan progress and open sessions between cron invocations; the lease prevents concurrent sends. */
export async function runScheduledKeeper(env: KeeperEnv): Promise<void> {
  if (!env.KEEPER_RPC_URL || !env.KEEPER_GAME_ADDRESS || !env.KEEPER_FROM_BLOCK || !env.KEEPER_PRIVATE_KEY) {
    throw new Error('KEEPER_NOT_CONFIGURED')
  }
  const game = env.KEEPER_GAME_ADDRESS.toLowerCase()
  const now = Date.now()
  const leaseUntil = now + 900_000
  await env.COLLECTION_DB.prepare('INSERT OR IGNORE INTO keeper_state (game, cursor, sessions, leased_until) VALUES (?, ?, ?, 0)')
    .bind(game, env.KEEPER_FROM_BLOCK, '[]').run()
  const lease = await env.COLLECTION_DB.prepare('UPDATE keeper_state SET leased_until = ? WHERE game = ? AND leased_until < ?')
    .bind(leaseUntil, game, now).run()
  if (lease.meta.changes !== 1) return
  try {
    const stored = await env.COLLECTION_DB.prepare('SELECT cursor, sessions FROM keeper_state WHERE game = ?')
      .bind(game).first<{ cursor: string; sessions: string }>()
    if (!stored || !/^\d+$/.test(stored.cursor)) throw new Error('INVALID_KEEPER_CHECKPOINT')
    const sessions: unknown = JSON.parse(stored.sessions)
    if (!Array.isArray(sessions) || sessions.some(id => typeof id !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(id))) {
      throw new Error('INVALID_KEEPER_CHECKPOINT')
    }
    const checkpoint: KeeperCheckpoint = { cursor: stored.cursor, sessions: sessions as Hex[] }
    const keeper = await createKeeper({
      rpcUrl: env.KEEPER_RPC_URL, game: game as Address, fromBlock: BigInt(env.KEEPER_FROM_BLOCK),
      graceSec: 60n, logChunk: 100n, send: true, keyPath: null, loop: false, pollMs: 5000,
    }, { account: privateKeyToAccount(env.KEEPER_PRIVATE_KEY as Hex), checkpoint, maxScanBlocks: 1000n })
    if (keeper.chainId !== 10143) throw new Error('KEEPER_WRONG_CHAIN')
    const report = await keeper.runOnce()
    const next = keeper.checkpoint()
    await env.COLLECTION_DB.prepare('UPDATE keeper_state SET cursor = ?, sessions = ? WHERE game = ? AND leased_until = ?')
      .bind(next.cursor, JSON.stringify(next.sessions), game, leaseUntil).run()
    console.log(formatAction(report))
  } finally {
    await env.COLLECTION_DB.prepare('UPDATE keeper_state SET leased_until = 0 WHERE game = ? AND leased_until = ?').bind(game, leaseUntil).run()
  }
}
