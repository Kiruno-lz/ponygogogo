// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RaceEntropy} from "./RaceEntropy.sol";
import {PaidCardRules} from "./PaidCardRules.sol";

/// @notice Fourteen-card no-replacement deck from a verified eligibility bitmap.
library PaidDeck {
    error InvalidCardMask();
    error CardPoolTooSmall();

    uint256 internal constant FULL_MASK = (1 << PaidCardRules.CARD_COUNT) - 1;
    uint256 internal constant RARE_MASK = PaidCardRules.RARE_MASK;
    bytes32 internal constant CARD_DOMAIN = keccak256("card");

    function derive(bytes32 seed, bytes32 anchor) internal pure returns (uint8[14] memory) {
        return derive(seed, anchor, FULL_MASK);
    }

    function derive(bytes32 seed, bytes32 anchor, uint256 eligibleMask) internal pure returns (uint8[14] memory deck) {
        if (eligibleMask & ~FULL_MASK != 0) revert InvalidCardMask();
        uint8[40] memory all;
        uint8[40] memory rare;
        uint256 allLength;
        uint256 rareLength;
        for (uint8 id = 1; id <= PaidCardRules.CARD_COUNT; ++id) {
            uint256 bit = 1 << (id - 1);
            if (eligibleMask & bit == 0) continue;
            all[allLength++] = id;
            if (RARE_MASK & bit != 0) rare[rareLength++] = id;
        }
        if (allLength < 14 || rareLength < 2) revert CardPoolTooSmall();
        deck[12] = _draw(rare, rareLength, seed, anchor, 0);
        deck[13] = _draw(rare, rareLength - 1, seed, anchor, 1);

        uint8[40] memory rest;
        uint256 restLength;
        for (uint256 i; i < allLength; ++i) {
            if (all[i] != deck[12] && all[i] != deck[13]) rest[restLength++] = all[i];
        }
        for (uint256 i; i < 12; ++i) {
            deck[i] = _draw(rest, restLength - i, seed, anchor, i + 2);
        }
    }

    function _draw(uint8[40] memory pool, uint256 length, bytes32 seed, bytes32 anchor, uint256 position)
        private
        pure
        returns (uint8 picked)
    {
        uint256 index = RaceEntropy.derive(seed, anchor, 0, CARD_DOMAIN, position) % length;
        picked = pool[index];
        for (uint256 i = index; i + 1 < length; ++i) {
            pool[i] = pool[i + 1];
        }
    }
}
