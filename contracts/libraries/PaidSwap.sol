// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RaceEntropy} from "./RaceEntropy.sol";

/// @notice C-09 swaps lane and position; progress, base speed and stamina stay with each horse.
library PaidSwap {
    error InvalidSwapState();

    bytes32 internal constant SWAP_DOMAIN = keccak256("swap");

    struct Horse {
        uint8 laneIndex;
        uint64 pos;
        uint64 dist;
        bool finished;
        bool immune;
    }

    function triggerMs(uint256 appliedAtMs, uint256 triggerIndex) internal pure returns (uint256) {
        return triggerIndex < 15 ? appliedAtMs + triggerIndex * 2000 : type(uint256).max;
    }

    function swap(
        Horse[5] memory horses,
        uint8 ownerHorseId,
        bytes32 seed,
        bytes32 cardAnchor,
        uint8 cardCheckpoint,
        uint256 triggerIndex
    ) internal pure returns (Horse[5] memory next, uint8 targetHorseId, bool swapped) {
        if (ownerHorseId > 4) revert InvalidSwapState();
        uint8 occupied;
        for (uint8 i; i < 5; ++i) {
            uint8 lane = horses[i].laneIndex;
            if (lane > 4 || occupied & (uint8(1) << lane) != 0) revert InvalidSwapState();
            occupied |= uint8(1) << lane;
        }
        next = horses;
        uint8 ownerLane = next[ownerHorseId].laneIndex;
        uint8 drawn = uint8(RaceEntropy.derive(seed, cardAnchor, cardCheckpoint, SWAP_DOMAIN, triggerIndex) % 4);
        uint8 targetLane = drawn >= ownerLane ? drawn + 1 : drawn;
        for (uint8 i; i < 5; ++i) {
            if (next[i].laneIndex == targetLane) {
                targetHorseId = i;
                break;
            }
        }
        if (
            next[ownerHorseId].finished || next[ownerHorseId].immune || next[targetHorseId].finished
                || next[targetHorseId].immune
        ) return (next, targetHorseId, false);
        uint64 oldPos = next[ownerHorseId].pos;
        next[ownerHorseId].pos = next[targetHorseId].pos;
        next[targetHorseId].pos = oldPos;
        next[ownerHorseId].laneIndex = targetLane;
        next[targetHorseId].laneIndex = ownerLane;
        return (next, targetHorseId, true);
    }
}
