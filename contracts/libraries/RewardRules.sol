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
            hex"000202010003030100040401000505010006060100090901000a0a01000b0b01000d0d0100101001001212010015150100161601001a1a01001e1e01001f1f010020200100222201002323010025250100262601002727010028280101054503010646030107470301084803";
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
