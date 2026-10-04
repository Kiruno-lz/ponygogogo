// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidSwap} from "../../contracts/libraries/PaidSwap.sol";

contract PaidSwapTest {
    function testTriggerScheduleStopsBeforeExpiry() public pure {
        require(PaidSwap.triggerMs(10_000, 0) == 10_000, "immediate");
        require(PaidSwap.triggerMs(10_000, 14) == 38_000, "last");
        require(PaidSwap.triggerMs(10_000, 15) == type(uint256).max, "expires first");
    }

    function testOriginalAnchorTargetAndDistancePreservation() public pure {
        PaidSwap.Horse[5] memory horses;
        for (uint8 i; i < 5; ++i) {
            horses[i] = PaidSwap.Horse(i, uint64(i) * 10_000, uint64(i) * 8_000, false, false);
        }
        (PaidSwap.Horse[5] memory next, uint8 target, bool swapped) = PaidSwap.swap(
            horses,
            1,
            bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111)),
            bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222)),
            1,
            0
        );
        require(target == 3 && swapped, "target");
        require(next[1].laneIndex == 3 && next[1].pos == 30_000 && next[1].dist == 8_000, "owner");
        require(next[3].laneIndex == 1 && next[3].pos == 10_000 && next[3].dist == 24_000, "other");
    }
}
