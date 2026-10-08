// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/playerBalance.ts by scripts/gen-paid-card-rules.ts.
library PlayerBalance {
    bytes32 internal constant TABLE_HASH = 0x5645fd7b0fe03f8f06973a56e85137b1c6095affba62fdede5bde3ae9a877fb8;
    uint256 internal constant START_SPEED = 300;
    uint256 internal constant ACCELERATION = 150;
    uint256 internal constant SPEED_CAP = 1800;
    uint256 internal constant STAMINA_CAPACITY = 300000000;
    uint256 internal constant EXHAUST_RELEASE = 135000000;
    uint256 internal constant COST_PER_MS = 20000;
    uint256 internal constant REGEN_PER_MS = 10000;
    uint256 internal constant EXHAUST_REGEN_PER_MS = 15000;
    uint256 internal constant EXHAUST_SPEED_CAP_MILLI = 1200000;
    uint256 internal constant OVERCAP_COST_DIVISOR = 2;
}
