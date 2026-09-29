import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, type Address, type Hex } from 'viem'

const DOMAIN = keccak256(toBytes('ponygogogo/session-seed/v1'))
const FIELDS = parseAbiParameters('bytes32 domain, uint256 chainId, address game, address player, uint256 nonce')

/** Public seed fixed by Game/account/nonce before the opening block hash exists. */
export function derivePaidSeed(chainId: bigint, game: Address, player: Address, nonce: bigint): Hex {
  if (chainId <= 0n || nonce < 0n) throw new Error('INVALID_SESSION_SEED_INPUT')
  return keccak256(encodeAbiParameters(FIELDS, [DOMAIN, chainId, game, player, nonce]))
}
