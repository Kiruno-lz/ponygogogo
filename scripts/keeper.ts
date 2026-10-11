/** Current-session keeper CLI. Dry-run by default; --send enables owner transactions. */
import { readFileSync } from 'node:fs'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createKeeper as createKeeperCore, formatAction, parseConfig, revertReason, type KeeperConfig } from '../src/chain/keeper.ts'
export * from '../src/chain/keeper.ts'

/** Reads a 0x-prefixed 32-byte key; the error never echoes file content. */
export function readDeployerKey(path: string): Hex {
  const raw = readFileSync(path, 'utf8').trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('INVALID_DEPLOYER_KEY')
  return raw as Hex
}

export function createKeeper(config: KeeperConfig) {
  return createKeeperCore(config, { account: config.send && config.keyPath ? privateKeyToAccount(readDeployerKey(config.keyPath)) : undefined })
}

const USAGE = `usage: PONY_GAME=0x... [KEEPER_FROM_BLOCK=n] bun scripts/keeper.ts [--send] [--loop]
  dry-run unless --send or KEEPER_SEND=1; see the header of scripts/keeper.ts for every variable`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return
  }
  const config = parseConfig(process.env, argv)
  const keeper = await createKeeper(config)
  for (; ;) {
    const report = await keeper.runOnce()
    for (const action of report.actions) console.log(formatAction(action))
    console.log(formatAction({
      kind: 'summary', dryRun: !config.send, sender: keeper.sender, latestBlock: report.latestBlock,
      now: report.now, watched: report.watched, actions: report.actions.length,
    }))
    if (!config.loop) return
    await new Promise((resolve) => setTimeout(resolve, config.pollMs))
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(formatAction({ kind: 'fatal', reason: revertReason(error) }))
    process.exit(1)
  })
}
