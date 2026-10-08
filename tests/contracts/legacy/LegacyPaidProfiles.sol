// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidProfiles} from "../../../contracts/libraries/PaidProfiles.sol";
import {RaceEntropy} from "../../../contracts/libraries/RaceEntropy.sol";

/// @dev Test-only tier personalities of the archived no-roster rules (derivePaidProfiles(..., legacy = true) in
/// src/race/core/paidProfiles.ts). Production PaidProfiles derives roster-rule CPUs from the player baseline.
library LegacyPaidProfiles {
    bytes32 internal constant BASE_DOMAIN = keccak256("horse.base");
    bytes32 internal constant ACCEL_DOMAIN = keccak256("horse.acceleration");

    function derive(bytes32 seed, bytes32 anchor, uint8 stakeTier, uint8 playerHorseId)
        internal
        pure
        returns (PaidProfiles.Profile[5] memory profiles)
    {
        if (playerHorseId >= 5) revert PaidProfiles.InvalidHorse();
        if (stakeTier == 0 || stakeTier > 4) revert PaidProfiles.InvalidTier();
        uint32[4] memory baseLo = [uint32(1120), 1180, 1240, 1300];
        uint32[4] memory accelLo = [uint32(10), 11, 12, 13];
        uint32[4] memory capLo = [uint32(1700), 1780, 1860, 1940];
        uint256 tier = stakeTier - 1;
        uint256 group;
        for (uint256 horseId; horseId < 5; ++horseId) {
            if (horseId == playerHorseId) {
                profiles[horseId] = PaidProfiles.Profile(1200, 12, 1800);
                continue;
            }
            profiles[horseId] = PaidProfiles.Profile(
                baseLo[tier] + uint32(RaceEntropy.derive(seed, anchor, 0, BASE_DOMAIN, group) % 121),
                accelLo[tier] + uint32(RaceEntropy.derive(seed, anchor, 0, ACCEL_DOMAIN, group) % 4),
                capLo[tier] + uint32(RaceEntropy.derive(seed, anchor, 0, PaidProfiles.CAP_DOMAIN, group) % 141)
            );
            ++group;
        }
    }
}
