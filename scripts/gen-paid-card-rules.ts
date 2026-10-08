import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, keccak256 } from 'viem'
import { PLAYER_BALANCE, PLAYER_BALANCE_HASH } from '../src/race/paid/playerBalance.ts'
import {
  CARD_EFFECT, CARD_MAIN_FUNCTION, PAID_CARD_GLOBALS, PAID_CARD_RULES, PAID_CARD_RULES_HASH, PAID_CPU_MASK, PAID_RARE_MASK,
  PAID_RULESET_HASH, LEGACY_PAID_RULESET_HASH, paidCardRuleTuple,
} from '../src/race/paid/cardRules.ts'

const target = fileURLToPath(new URL('../contracts/libraries/PaidCardRules.sol', import.meta.url))
const check = process.argv.includes('--check')
const playerTarget = fileURLToPath(new URL('../contracts/libraries/PlayerBalance.sol', import.meta.url))
const playerConstants = {
  START_SPEED: PLAYER_BALANCE.startSpeed,
  ACCELERATION: PLAYER_BALANCE.acceleration,
  SPEED_CAP: PLAYER_BALANCE.speedCap,
  STAMINA_CAPACITY: PLAYER_BALANCE.staminaCapacity * 1_000_000,
  EXHAUST_RELEASE: PLAYER_BALANCE.exhaustRelease * 1_000_000,
  COST_PER_MS: PLAYER_BALANCE.staminaCostPerSecond * 1000,
  REGEN_PER_MS: PLAYER_BALANCE.staminaRegenPerSecond * 1000,
  EXHAUST_REGEN_PER_MS: PLAYER_BALANCE.exhaustRegenPerSecond * 1000,
  EXHAUST_SPEED_CAP_MILLI: PLAYER_BALANCE.exhaustSpeedCap * 1000,
  OVERCAP_COST_DIVISOR: PLAYER_BALANCE.overcapCostDivisor,
  CPU_CAP_OFFSET_MIN: PLAYER_BALANCE.cpuCapOffsetMin,
  CPU_CAP_OFFSET_MAX: PLAYER_BALANCE.cpuCapOffsetMax,
}
const playerSource = execFileSync('forge', ['fmt', '--raw', '-'], { encoding: 'utf8', input: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/playerBalance.ts by scripts/gen-paid-card-rules.ts.
library PlayerBalance {
    bytes32 internal constant TABLE_HASH = ${PLAYER_BALANCE_HASH};
${Object.entries(playerConstants).map(([key, value]) => `    uint256 internal constant ${key} = ${value};`).join('\n')}
}
` })
if (check) {
  if (readFileSync(playerTarget, 'utf8') !== playerSource) throw new Error('PLAYER_BALANCE_STALE')
} else writeFileSync(playerTarget, playerSource)
const fields = [
  'id', 'effect', 'rare', 'cpu', 'durationMs', 'bonusMode', 'pBps', 'fixedSpeed',
  'staminaMicro', 'regenBonusBps', 'costMultiplierBps', 'slot', 'radiusMicro',
  'strengthBps', 'overlapBps', 'periodMs', 'count', 'bonusBps', 'autoPanelSec', 'coatRgb',
  'fallbackBps', 'costDeltaBps', 'triggerDurationMs', 'thresholdMicro', 'triggerFixedSpeed',
]
const types = [
  'uint8', 'uint8', 'bool', 'bool', 'uint32', 'uint8', 'int32', 'int16',
  'uint32', 'uint16', 'uint16', 'uint8', 'uint64', 'uint16', 'int16', 'uint32',
  'uint8', 'uint16', 'uint8', 'uint32',
  'int32', 'int16', 'uint32', 'uint32', 'int16',
]

if (PAID_CARD_RULES.length > 255 || PAID_CARD_RULES.some((card, i) => card.id !== i + 1)) {
  throw new Error('PAID_CARD_RULE_IDS_INVALID')
}
if (PAID_CARD_RULES.filter((card) => card.rare).length < 2 || PAID_CARD_RULES.filter((card) => card.cpu).length < 3) {
  throw new Error('PAID_CARD_POOL_TOO_SMALL')
}

/**
 * get(id) decodes a packed record instead of building struct literals, which keeps the table about 3 KB smaller
 * in every contract that reads it. Record = the tuple fields big-endian at
 * the byte widths below: the first 13 fields (id..radiusMicro) fill word `hi`, the remaining fields fill word `lo`;
 * signed fields are two's complement at their width.
 */
const widths = [1, 1, 1, 1, 4, 1, 4, 2, 4, 2, 2, 1, 8, 2, 2, 4, 1, 2, 1, 4, 4, 2, 4, 4, 2]
const HI_FIELDS = 13
const WORD_BYTES = [32, 32]
for (const [w, bytes] of [[widths.slice(0, HI_FIELDS), 32], [widths.slice(HI_FIELDS), 32]] as const) {
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
  // RGB needs 24 bits; the unused high byte holds the frozen main-function classification.
  if (tuple[19]! > 0xffffff) throw new Error('COAT_RGB_OUT_OF_RANGE')
  tuple[19] = tuple[19]! + CARD_MAIN_FUNCTION[card.mainFunction] * 0x1000000
  return hex(packWord(tuple.slice(0, HI_FIELDS), widths.slice(0, HI_FIELDS)), WORD_BYTES[0]!).slice(2)
    + hex(packWord(tuple.slice(HI_FIELDS), widths.slice(HI_FIELDS)), WORD_BYTES[1]!).slice(2)
}).join('')

let bitsLeft = 256
const decode = '        assembly ("memory-safe") {\n' + fields.map((field, i) => {
  if (i === HI_FIELDS) bitsLeft = 256
  bitsLeft -= widths[i]! * 8
  const word = i < HI_FIELDS ? 'hi' : 'lo'
  let value = bitsLeft === 0 ? word : `shr(${bitsLeft}, ${word})`
  const width = widths[i]!
  if (types[i] === 'bool') value = `iszero(iszero(and(${value}, 255)))`
  else if (types[i]!.startsWith('int')) value = `signextend(${width - 1}, ${value})`
  else value = `and(${value}, 0x${((1n << BigInt(field === 'coatRgb' ? 24 : width * 8)) - 1n).toString(16)})`
  return `            mstore(add(rule, ${i * 32}), ${value}) // ${field}`
}).join('\n') + '\n        }'

const abiComponents = fields.map((name, i) => ({ name, type: types[i]! }))
const encodedRulesHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: abiComponents }], [
  PAID_CARD_RULES.map((card) => Object.fromEntries(paidCardRuleTuple(card).map((value, i) =>
    [fields[i]!, types[i] === 'bool' ? value === 1 : BigInt(value)]))),
]))

const effects = Object.entries(CARD_EFFECT).map(([name, id]) => {
  const symbol = name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()
  return `    uint8 internal constant EFFECT_${symbol} = ${id};`
}).join('\n')
const flameLayers = PAID_CARD_RULES[10]!.flameLayers!
const mileageStages = PAID_CARD_RULES[39]!.baseStages!
const packedMileageStages = mileageStages.reduce((word, value) => (word << 16n) | BigInt.asUintN(16, BigInt(value)), 0n)

const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/cardRules.ts. Edit that source, then run bun scripts/gen-paid-card-rules.ts.
library PaidCardRules {
    error InvalidCard();

    bytes32 internal constant TABLE_HASH = ${PAID_CARD_RULES_HASH};
    bytes32 internal constant RULESET_HASH = ${PAID_RULESET_HASH};
    bytes32 internal constant LEGACY_RULESET_HASH = ${LEGACY_PAID_RULESET_HASH};
    uint256 internal constant RARE_MASK = 0x${PAID_RARE_MASK.toString(16)};
    uint256 internal constant CPU_MASK = 0x${PAID_CPU_MASK.toString(16)};
    uint32 internal constant PERMANENT_MS = type(uint32).max;
    uint8 internal constant CARD_COUNT = ${PAID_CARD_RULES.length};
    uint16 internal constant MIN_COST_FACTOR_BPS = ${PAID_CARD_GLOBALS.minCostFactorBps};
${Object.entries(CARD_MAIN_FUNCTION).map(([key, value]) => `    uint8 internal constant MAIN_${key.toUpperCase()} = ${value};`).join('\n')}
    uint32 internal constant BONUS_DEFAULT_MS = ${PAID_CARD_GLOBALS.bonusDefaultMs};
    uint256 internal constant RK_STEP_MS = ${PAID_CARD_GLOBALS.rkStepMs};
${effects}

    struct Rule {
${fields.map((field, i) => `        ${types[i]} ${field};`).join('\n')}
    }

    /// @notice keccak256(abi.encode(Rule[])) for all ${PAID_CARD_RULES.length} cards of the TS table; PaidCardRules.t.sol recomputes it from get().
    bytes32 internal constant ENCODED_RULES_HASH = ${encodedRulesHash};

    function get(uint8 id) internal pure returns (Rule memory rule) {
        (uint256 hi, uint256 lo) = packed(id);
        return decode(hi, lo);
    }

    function mainFunction(uint8 id) internal pure returns (uint8) {
        (, uint256 lo) = packed(id);
        return uint8(lo >> 152);
    }

    function flameLayer(uint256 stage) internal pure returns (uint256) {
        if (stage >= ${flameLayers.length}) revert InvalidCard();
        return uint8(uint256(${hex(flameLayers.reduce((w,v)=>(w<<8n)|BigInt(v),0n), flameLayers.length)}) >> (8 * (${flameLayers.length - 1} - stage)));
    }

    /// @notice C-40 fixed base-speed values, generated from its canonical baseStages.
    function mileageSpeed(uint256 stage) internal pure returns (int256) {
        if (stage >= ${mileageStages.length}) revert InvalidCard();
        return int16(uint16(uint256(${hex(packedMileageStages, mileageStages.length * 2)}) >> (16 * (${mileageStages.length - 1} - stage))));
    }

    function decode(uint256 hi, uint256 lo) internal pure returns (Rule memory rule) {
${decode}
    }

    function packed(uint8 id) internal pure returns (uint256 hi, uint256 lo) {
        if (id == 0 || id > CARD_COUNT) revert InvalidCard();
        bytes memory data = hex"${packed}";
        assembly ("memory-safe") {
            let at := add(add(data, 0x20), shl(6, sub(and(id, 255), 1)))
            hi := mload(at)
            lo := mload(add(at, 0x20))
        }
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
