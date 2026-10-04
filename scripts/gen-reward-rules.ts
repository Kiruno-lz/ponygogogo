import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { REWARD_ASSETS, REWARD_RULES } from '../src/race/paid/rewardRules.ts'

const path = new URL('../contracts/libraries/RewardRules.sol', import.meta.url)
const packed = REWARD_ASSETS.flatMap(a => [a.assetKind, a.assetId, a.bit, a.weight]).map(n => {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('REWARD_FIELD_OUT_OF_RANGE')
  return n.toString(16).padStart(2, '0')
}).join('')
const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/rewardRules.ts; run bun scripts/gen-reward-rules.ts.
library RewardRules {
    uint256 internal constant GRANT_CHANCE_BPS = ${REWARD_RULES.grantChanceBps};
    uint256 internal constant RECORD_GAS = ${REWARD_RULES.recordGas};
    uint256 internal constant GAS_RESERVE = ${REWARD_RULES.gasReserve};

    function draw(bytes32 seed, uint256 owned) internal pure returns (bool, uint8, uint8) {
        return atRoll(uint256(keccak256(abi.encode(seed, uint256(0)))) % 10000,
            uint256(keccak256(abi.encode(seed, uint256(1)))), owned);
    }

    function atRoll(uint256 roll, uint256 pick, uint256 owned) internal pure returns (bool, uint8, uint8) {
        if (roll >= GRANT_CHANCE_BPS) return (false, 0, 0);
        bytes memory assets = hex"${packed}";
        uint256 total;
        for (uint256 i; i < assets.length; i += 4) {
            if (owned & (uint256(1) << uint8(assets[i + 2])) == 0) total += uint8(assets[i + 3]);
        }
        if (total == 0) return (false, 0, 0);
        pick %= total;
        for (uint256 i; i < assets.length; i += 4) {
            if (owned & (uint256(1) << uint8(assets[i + 2])) != 0) continue;
            uint256 weight = uint8(assets[i + 3]);
            if (pick < weight) return (true, uint8(assets[i]), uint8(assets[i + 1]));
            pick -= weight;
        }
        revert();
    }
}
`
const formatted = execFileSync('forge', ['fmt', '--raw', '-'], { input: source, encoding: 'utf8' })
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== formatted) throw new Error('REWARD_RULES_OUT_OF_DATE')
} else writeFileSync(path, formatted)
