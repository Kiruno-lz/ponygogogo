// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/ponyRules.ts; run bun scripts/gen-pony-rules.ts.
library PonyRules {
    error InvalidPony();
    bytes32 internal constant TABLE_HASH = 0x31a186a46b40691dad3ace7030df39000af764e407d1ba0124844d46c4137744;
    bytes32 internal constant ENCODED_RULES_HASH = 0x88b0f9a5ee7f0a54e2cbc90e5e67d511ed77d3be698bf644f1aff85e43d87e81;
    uint8 internal constant PONY_COUNT = 9;
    uint256 internal constant ENABLED_MASK = 0x1ff;
    uint8 internal constant RARE_SPECIALIST = 0;
    uint8 internal constant REFRESH = 1;
    uint8 internal constant LONG_EQUIPMENT = 2;
    uint8 internal constant DIVERSE = 3;
    uint8 internal constant AIRBORNE = 4;
    uint8 internal constant OX = 5;
    uint8 internal constant FORFEIT = 6;
    uint8 internal constant FOOD = 7;
    uint8 internal constant REPEAT = 8;

    struct Rule {
        uint8 id;
        bool enabled;
        uint8 ability;
        uint16 bonusBps;
        uint32 durationMs;
        uint16 equipmentDurationBps;
        uint16 capDelta;
        uint16 costDeltaBps;
        uint32 staminaMicro;
        uint8 refreshCount;
        uint16 staminaCapacityDelta;
    }

    function enabled(uint8 id) internal pure returns (bool) {
        return ENABLED_MASK & (uint256(1) << id) != 0;
    }

    function packed(uint8 id) internal pure returns (uint256 word) {
        if (id >= PONY_COUNT) revert InvalidPony();
        bytes memory data =
            hex"000000000000000000000000000001000190000000000000000000000000000000000000000000000000000001010101000000000000000000000000000000000000000000000000000000000002010203e8000000003a98000000000000000000000000000000000000000000030103012c00004e20000000000000000000000000000000000000000000000004010409c40000000000000000000000000000000000000000000000000000000501050000000000000000006403e80000000000000000000000000000000000060106064000004e20000000000000000000000000000000000000000000640007010700000000000000000000000002faf0800000000000000000000000000008010804b000004e2000000000000000000000";
        assembly ("memory-safe") { word := mload(add(add(data, 32), shl(5, and(id, 255)))) }
    }

    function get(uint8 id) internal pure returns (Rule memory rule) {
        uint256 word = packed(id);
        assembly ("memory-safe") {
            mstore(add(rule, 0), and(shr(144, word), 0xff)) // id
            mstore(add(rule, 32), and(shr(136, word), 0xff)) // enabled
            mstore(add(rule, 64), and(shr(128, word), 0xff)) // ability
            mstore(add(rule, 96), and(shr(112, word), 0xffff)) // bonusBps
            mstore(add(rule, 128), and(shr(80, word), 0xffffffff)) // durationMs
            mstore(add(rule, 160), and(shr(64, word), 0xffff)) // equipmentDurationBps
            mstore(add(rule, 192), and(shr(48, word), 0xffff)) // capDelta
            mstore(add(rule, 224), and(shr(32, word), 0xffff)) // costDeltaBps
            mstore(add(rule, 256), and(shr(0, word), 0xffffffff)) // staminaMicro
            mstore(add(rule, 288), and(shr(152, word), 0xff)) // refreshCount
            mstore(add(rule, 320), and(shr(160, word), 0xffff)) // staminaCapacityDelta
        }
    }
}
