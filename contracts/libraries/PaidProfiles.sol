// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlayerBalance} from "./PlayerBalance.sol";

import {RaceEntropy} from "./RaceEntropy.sol";

/// @notice Opening-anchor personalities: every CPU runs the player baseline with a uniform cap offset.
/// @dev The stake tier is validated but does not shape profiles (derivePaidProfiles in src/race/core/paidProfiles.ts).
library PaidProfiles {
    error InvalidHorse();
    error InvalidTier();

    struct Profile {
        uint32 base;
        uint32 acceleration;
        uint32 cap;
    }

    bytes32 internal constant CAP_DOMAIN = keccak256("horse.cap");

    function derive(bytes32 seed, bytes32 anchor, uint8 stakeTier, uint8 playerHorseId)
        internal
        pure
        returns (Profile[5] memory profiles)
    {
        if (playerHorseId >= 5) revert InvalidHorse();
        if (stakeTier == 0 || stakeTier > 4) revert InvalidTier();
        uint256 span = PlayerBalance.CPU_CAP_OFFSET_MAX - PlayerBalance.CPU_CAP_OFFSET_MIN + 1;
        uint256 group;
        for (uint256 horseId; horseId < 5; ++horseId) {
            uint256 cap = PlayerBalance.SPEED_CAP;
            if (horseId != playerHorseId) {
                cap += PlayerBalance.CPU_CAP_OFFSET_MIN + RaceEntropy.derive(seed, anchor, 0, CAP_DOMAIN, group) % span;
                ++group;
            }
            profiles[horseId] =
                Profile(uint32(PlayerBalance.START_SPEED), uint32(PlayerBalance.ACCELERATION), uint32(cap));
        }
    }
}
