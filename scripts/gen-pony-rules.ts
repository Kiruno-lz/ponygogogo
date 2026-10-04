import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeAbiParameters, keccak256 } from 'viem'
import { PONY_ABILITY, PONY_RULES, PONY_RULES_HASH, ponyRuleTuple } from '../src/race/paid/ponyRules.ts'

const path = new URL('../contracts/libraries/PonyRules.sol', import.meta.url)
const names = ['id', 'enabled', 'ability', 'bonusBps', 'durationMs', 'equipmentDurationBps', 'capDelta', 'costDeltaBps', 'staminaMicro']
const types = ['uint8', 'bool', 'uint8', 'uint16', 'uint32', 'uint16', 'uint16', 'uint16', 'uint32']
const widths = [1, 1, 1, 2, 4, 2, 2, 2, 4]
if (PONY_RULES.some((p, i) => p.id !== i) || PONY_RULES.length > 192) throw new Error('INVALID_PONY_IDS')
const packed = PONY_RULES.map(rule => {
  let word = 0n
  ponyRuleTuple(rule).forEach((n, i) => {
    const bits = BigInt(widths[i]! * 8)
    if (!Number.isInteger(n) || n < 0 || BigInt(n) >= (1n << bits)) throw new Error('PONY_RULE_RANGE')
    word = (word << bits) | BigInt(n)
  })
  return word.toString(16).padStart(64, '0')
}).join('')
let left = widths.reduce((s, w) => s + w * 8, 0)
const decode = names.map((name, i) => {
  const bits = widths[i]! * 8; left -= bits
  const value = `and(shr(${left}, word), 0x${((1n << BigInt(bits)) - 1n).toString(16)})`
  return `            mstore(add(rule, ${i * 32}), ${value}) // ${name}`
}).join('\n')
const encodedHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: names.map((name, i) => ({ name, type: types[i]! })) }],
  [PONY_RULES.map(rule => Object.fromEntries(ponyRuleTuple(rule).map((v, i) => [names[i]!, i === 1 ? v === 1 : BigInt(v)])))]))
const enabledMask = PONY_RULES.reduce((mask, r) => mask | (r.enabled ? 1n << BigInt(r.id) : 0n), 0n)
const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/ponyRules.ts; run bun scripts/gen-pony-rules.ts.
library PonyRules {
    error InvalidPony();
    bytes32 internal constant TABLE_HASH = ${PONY_RULES_HASH};
    bytes32 internal constant ENCODED_RULES_HASH = ${encodedHash};
    uint8 internal constant PONY_COUNT = ${PONY_RULES.length};
    uint256 internal constant ENABLED_MASK = 0x${enabledMask.toString(16)};
${Object.entries(PONY_ABILITY).map(([key, code]) => `    uint8 internal constant ${key.replace(/[A-Z]/g, l => '_' + l).toUpperCase()} = ${code};`).join('\n')}
    struct Rule {
${names.map((name, i) => `        ${types[i]} ${name};`).join('\n')}
    }
    function enabled(uint8 id) internal pure returns (bool) { return ENABLED_MASK & (uint256(1) << id) != 0; }
    function packed(uint8 id) internal pure returns (uint256 word) {
        if (id >= PONY_COUNT) revert InvalidPony();
        bytes memory data = hex"${packed}";
        assembly ("memory-safe") { word := mload(add(add(data, 32), shl(5, id))) }
    }
    function get(uint8 id) internal pure returns (Rule memory rule) {
        uint256 word = packed(id);
        assembly ("memory-safe") {
${decode}
        }
    }
}
`
const formatted = execFileSync('forge', ['fmt', '--raw', '-'], { input: source, encoding: 'utf8' })
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== formatted) throw new Error('PONY_RULES_OUT_OF_DATE')
} else writeFileSync(path, formatted)
