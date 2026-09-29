// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Gross return, including stake, in the native currency's smallest units (wei).
library RacePayout {
    uint256 internal constant BASIS_POINTS = 10_000;

    function gross(uint256 stake, uint16 multiplierBps) internal pure returns (uint256) {
        return Math.mulDiv(stake, multiplierBps, BASIS_POINTS);
    }

    function maximum(uint256 stake, uint16[5] memory multipliersBps) internal pure returns (uint256 largest) {
        for (uint256 i; i < 5; ++i) {
            uint256 payout = gross(stake, multipliersBps[i]);
            if (payout > largest) largest = payout;
        }
    }
}
