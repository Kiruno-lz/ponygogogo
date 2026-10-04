// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/ponyRules.ts; run bun scripts/gen-pony-rules.ts.
library PonyRules {
    error InvalidPony();
    bytes32 internal constant TABLE_HASH = 0xec5adcef7535a35ca83ecdd293618d5000837d4b94f4784e1e33e6544ebbb70f;
    bytes32 internal constant ENCODED_RULES_HASH = 0xde2239e7e3c3b76c2f2d3cb9aade045457379dc34f664dbbbaf5139391ca87fd;
    uint8 internal constant PONY_COUNT = 9;
    uint256 internal constant ENABLED_MASK = 0x1ff;
    uint8 internal constant RARE_SPECIALIST = 0;
    uint8 internal constant LIGHT = 1;
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
    }

    function enabled(uint8 id) internal pure returns (bool) {
        return ENABLED_MASK & (uint256(1) << id) != 0;
    }

    function packed(uint8 id) internal pure returns (uint256 word) {
        if (id >= PONY_COUNT) revert InvalidPony();
        bytes memory data =
            hex"0000000000000000000000000000010003e800000000000000000000000000000000000000000000000000000001010103200000000000000000000000000000000000000000000000000000000201020000000000002ee000000000000000000000000000000000000000000003010302bc00004e20000000000000000000000000000000000000000000000004010403200000000000000000000000000000000000000000000000000000000501050000000000000000006407d0000000000000000000000000000000000006010604b000004e20000000000000000000000000000000000000000000000007010700000000000000000000000002faf0800000000000000000000000000008010804b000004e2000000000000000000000";
        assembly ("memory-safe") { word := mload(add(add(data, 32), shl(5, id))) }
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
        }
    }
}
