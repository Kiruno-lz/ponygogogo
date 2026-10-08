// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/rewardRules.ts; run bun scripts/gen-reward-rules.ts.
library RewardRules {
    uint256 internal constant GRANT_CHANCE_BPS = 2000;
    uint256 internal constant RECORD_GAS = 120000;
    uint256 internal constant GAS_RESERVE = 200000;

    function draw(bytes32 seed, uint256 owned) internal pure returns (bool, uint8, uint8) {
        return atRoll(
            uint256(keccak256(abi.encode(seed, uint256(0)))) % 10000,
            uint256(keccak256(abi.encode(seed, uint256(1)))),
            owned
        );
    }

    function atRoll(uint256 roll, uint256 pick, uint256 owned) internal pure returns (bool, uint8, uint8) {
        if (roll >= GRANT_CHANCE_BPS) return (false, 0, 0);
        bytes memory assets =
            hex"0002020100030301000505010007070100090901000a0a010012120100151501001d1d010022220100232301002525010028280101054503010646030107470301084803";
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
