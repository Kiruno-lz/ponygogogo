import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, keccak256 } from 'viem'
import {
  CARD_EFFECT, PAID_CARD_GLOBALS, PAID_CARD_RULES, PAID_CARD_RULES_HASH, PAID_CPU_MASK, PAID_RARE_MASK,
  PAID_RULESET_HASH, paidCardRuleTuple,
} from '../src/race/paid/cardRules.ts'

const target = fileURLToPath(new URL('../contracts/PaidCardRules.sol', import.meta.url))
const check = process.argv.includes('--check')
const fields = [
  'id', 'effect', 'rare', 'cpu', 'durationMs', 'bonusMode', 'pBps', 'fixedSpeed',
  'staminaMicro', 'regenBonusBps', 'costMultiplierBps', 'slot', 'radiusMicro',
  'strengthBps', 'overlapBps', 'periodMs', 'count', 'bonusBps', 'autoPanelSec', 'coatRgb',
]
const types = [
  'uint8', 'uint8', 'bool', 'bool', 'uint32', 'uint8', 'int32', 'int16',
  'uint32', 'uint16', 'uint16', 'uint8', 'uint64', 'uint16', 'int16', 'uint32',
  'uint8', 'uint16', 'uint8', 'uint32',
]

if (PAID_CARD_RULES.length !== 26 || PAID_CARD_RULES.some((card, i) => card.id !== i + 1)) {
  throw new Error('PAID_CARD_RULE_IDS_INVALID')
}
if (PAID_CARD_RULES.filter((card) => card.rare).length < 2 || PAID_CARD_RULES.filter((card) => card.cpu).length < 3) {
  throw new Error('PAID_CARD_POOL_TOO_SMALL')
}

/**
 * get(id) decodes a packed record instead of building 26 struct literals, which keeps the table about 3 KB smaller
 * in every contract that reads it (PaidRaceSolver must stay under EIP-170). Record = the tuple fields big-endian at
 * the byte widths below: the first 13 fields (id..radiusMicro) fill word `hi`, the other 7 the low 16 bytes of `lo`;
 * signed fields are two's complement at their width.
 */
const widths = [1, 1, 1, 1, 4, 1, 4, 2, 4, 2, 2, 1, 8, 2, 2, 4, 1, 2, 1, 4]
const HI_FIELDS = 13
const WORD_BYTES = [32, 16]
for (const [w, bytes] of [[widths.slice(0, HI_FIELDS), 32], [widths.slice(HI_FIELDS), 16]] as const) {
  if (w.reduce((a, b) => a + b, 0) !== bytes) throw new Error('PAID_CARD_RULE_LAYOUT')
}
widths.forEach((w, i) => {
  if (Number.parseInt(types[i]!.replace(/\D/g, '') || '8', 10) !== w * 8) throw new Error('PAID_CARD_RULE_WIDTH')
})

function packWord(values: number[], fieldWidths: number[]): bigint {
  let word = 0n
  values.forEach((value, i) => {
    const bits = BigInt(fieldWidths[i]! * 8)
    const raw = BigInt.asUintN(Number(bits), BigInt(value))
    if (BigInt.asIntN(Number(bits), raw) !== BigInt(value) && raw !== BigInt(value)) throw new Error('PAID_CARD_RULE_RANGE')
    word = (word << bits) | raw
  })
  return word
}

const hex = (value: bigint, bytes: number) => `0x${value.toString(16).padStart(bytes * 2, '0')}`
const packed = PAID_CARD_RULES.map((card) => {
  const tuple = paidCardRuleTuple(card)
  const hi = packWord(tuple.slice(0, HI_FIELDS), widths.slice(0, HI_FIELDS))
  const lo = packWord(tuple.slice(HI_FIELDS), widths.slice(HI_FIELDS))
  const named = tuple.map((value, i) => [fields[i], value] as const)
    .filter(([name, value], i) => i > 0 && (value !== 0 || name === 'durationMs' || name === 'slot') && !(name === 'slot' && value === 255))
    .map(([name, value]) => `${name}=${value}`)
  return `        // C-${String(card.id).padStart(2, '0')} ${card.effect}: ${named.join(' ')}\n`
    + `        if (id == ${card.id}) return (${hex(hi, WORD_BYTES[0]!)}, ${hex(lo, WORD_BYTES[1]!)});`
}).join('\n')

let bitsLeft = 256
const decode = fields.map((field, i) => {
  if (i === HI_FIELDS) bitsLeft = 128
  bitsLeft -= widths[i]! * 8
  const word = i < HI_FIELDS ? 'hi' : 'lo'
  const shifted = bitsLeft === 0 ? word : `${word} >> ${bitsLeft}`
  const type = types[i]!
  if (type === 'bool') return `        rule.${field} = uint8(${shifted}) != 0;`
  if (type.startsWith('int')) return `        rule.${field} = ${type}(u${type}(${shifted}));`
  return `        rule.${field} = ${type}(${shifted});`
}).join('\n')

const abiComponents = fields.map((name, i) => ({ name, type: types[i]! }))
const encodedRulesHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: abiComponents }], [
  PAID_CARD_RULES.map((card) => Object.fromEntries(paidCardRuleTuple(card).map((value, i) =>
    [fields[i]!, types[i] === 'bool' ? value === 1 : BigInt(value)]))),
]))

const effects = Object.entries(CARD_EFFECT).map(([name, id]) => {
  const symbol = name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()
  return `    uint8 internal constant EFFECT_${symbol} = ${id};`
}).join('\n')

const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/cardRules.ts. Edit that source, then run bun scripts/gen-paid-card-rules.ts.
library PaidCardRules {
    error InvalidCard();

    bytes32 internal constant TABLE_HASH = ${PAID_CARD_RULES_HASH};
    bytes32 internal constant RULESET_HASH = ${PAID_RULESET_HASH};
    uint256 internal constant RARE_MASK = 0x${PAID_RARE_MASK.toString(16)};
    uint256 internal constant CPU_MASK = 0x${PAID_CPU_MASK.toString(16)};
    uint32 internal constant PERMANENT_MS = type(uint32).max;
    uint32 internal constant BONUS_DEFAULT_MS = ${PAID_CARD_GLOBALS.bonusDefaultMs};
${effects}

    struct Rule {
${fields.map((field, i) => `        ${types[i]} ${field};`).join('\n')}
    }

    /// @notice keccak256(abi.encode(Rule[26])) of the TS table; PaidCardRules.t.sol recomputes it from get().
    bytes32 internal constant ENCODED_RULES_HASH = ${encodedRulesHash};

    function get(uint8 id) internal pure returns (Rule memory rule) {
        (uint256 hi, uint256 lo) = _packed(id);
${decode}
    }

    function _packed(uint8 id) private pure returns (uint256 hi, uint256 lo) {
${packed}
        revert InvalidCard();
    }
}
`

const formatted = execFileSync('forge', ['fmt', '--raw', '-'], { input: source, encoding: 'utf8' })
if (check) {
  if (readFileSync(target, 'utf8') !== formatted) throw new Error('PAID_CARD_RULES_STALE')
  process.stdout.write(`PaidCardRules.sol matches ${PAID_CARD_RULES_HASH}\n`)
} else {
  writeFileSync(target, formatted)
  process.stdout.write(`Generated PaidCardRules.sol ${PAID_CARD_RULES_HASH}\n`)
}
