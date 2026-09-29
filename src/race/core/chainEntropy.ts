import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, type Hex } from 'viem'

const DERIVATION_FIELDS = parseAbiParameters('bytes32 seed, bytes32 anchor, uint8 checkpoint, bytes32 purpose, uint256 eventIndex')

export const PURPOSE_CARD = keccak256(toBytes('card'))

/** Paid-race entropy. Keep the ABI encoding identical to RaceEntropy.sol. */
export function chainEntropy(seed: Hex, anchor: Hex, checkpoint: number, purpose: Hex, eventIndex: bigint): bigint {
  return BigInt(keccak256(encodeAbiParameters(DERIVATION_FIELDS, [seed, anchor, checkpoint, purpose, eventIndex])))
}
