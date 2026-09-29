// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RaceEntropy} from "./RaceEntropy.sol";
import {PaidCardRules} from "./PaidCardRules.sol";

/// @notice Three deterministic private cards for one CPU horse.
library PaidCpuDeck {
    error InvalidHorse();

    uint256 internal constant CPU_MASK = PaidCardRules.CPU_MASK;
    bytes32 internal constant CPU_DOMAIN = keccak256("cpu.card");

    function derive(bytes32 seed, bytes32 anchor, uint8 horseId) internal pure returns (uint8[3] memory deck) {
        if (horseId >= 5) revert InvalidHorse();
        uint8[13] memory remaining;
        uint256 length;
        for (uint8 id = 1; id <= 21; ++id) {
            if (CPU_MASK & (1 << (id - 1)) != 0) remaining[length++] = id;
        }
        for (uint256 position; position < 3; ++position) {
            uint256 eventIndex = uint256(horseId) * 3 + position;
            uint256 index = RaceEntropy.derive(seed, anchor, 0, CPU_DOMAIN, eventIndex) % length;
            deck[position] = remaining[index];
            for (uint256 i = index; i + 1 < length; ++i) {
                remaining[i] = remaining[i + 1];
            }
            --length;
        }
    }
}
