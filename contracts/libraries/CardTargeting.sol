// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared admission rule for every cross-horse card effect, including beneficial and continuous effects.
library CardTargeting {
    function canAffect(uint256 source, uint256 target, bool targetIsolated) internal pure returns (bool) {
        return source == target || !targetIsolated;
    }
}
