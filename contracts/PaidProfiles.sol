// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RaceEntropy} from "./RaceEntropy.sol";

/// @notice Immutable personality derivation for the first paid ruleset candidate.
library PaidProfiles {
    error InvalidHorse();
    error InvalidTier();

    struct Profile {
        uint32 base;
        uint32 acceleration;
        uint32 cap;
    }

    bytes32 internal constant BASE_DOMAIN = keccak256("horse.base");
    bytes32 internal constant ACCEL_DOMAIN = keccak256("horse.acceleration");
    bytes32 internal constant CAP_DOMAIN = keccak256("horse.cap");

    function derive(bytes32 seed, bytes32 anchor, uint8 stakeTier, uint8 playerHorseId)
        internal
        pure
        returns (Profile[5] memory profiles)
    {
        if (playerHorseId >= 5) revert InvalidHorse();
        if (stakeTier == 0 || stakeTier > 4) revert InvalidTier();
        uint32[4] memory baseLo = [uint32(1120), 1180, 1240, 1300];
        uint32[4] memory accelLo = [uint32(10), 11, 12, 13];
        uint32[4] memory capLo = [uint32(1700), 1780, 1860, 1940];
        uint256 tier = stakeTier - 1;
        uint256 group;
        for (uint256 horseId; horseId < 5; ++horseId) {
            if (horseId == playerHorseId) {
                profiles[horseId] = Profile(1200, 12, 1800);
                continue;
            }
            profiles[horseId] = Profile(
                baseLo[tier] + uint32(RaceEntropy.derive(seed, anchor, 0, BASE_DOMAIN, group) % 121),
                accelLo[tier] + uint32(RaceEntropy.derive(seed, anchor, 0, ACCEL_DOMAIN, group) % 4),
                capLo[tier] + uint32(RaceEntropy.derive(seed, anchor, 0, CAP_DOMAIN, group) % 141)
            );
            ++group;
        }
    }
}
