// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Physical finish order and the card-set exception used solely for payout.
library PaidSettlement {
    error InvalidPlayerHorse();

    function resolve(uint32[5] memory finishMs, uint8 playerHorseId, uint8[3] memory acquiredCards)
        internal
        pure
        returns (
            uint8[5] memory rawOrder,
            uint8[5] memory settlementOrder,
            uint8 rawRank,
            uint8 settlementRank,
            bool versionAnswer
        )
    {
        if (playerHorseId > 4) revert InvalidPlayerHorse();
        for (uint8 i; i < 5; ++i) {
            rawOrder[i] = i;
        }
        for (uint8 i = 1; i < 5; ++i) {
            uint8 candidate = rawOrder[i];
            uint8 j = i;
            while (
                j > 0
                    && (finishMs[candidate] < finishMs[rawOrder[j - 1]]
                        || (finishMs[candidate] == finishMs[rawOrder[j - 1]] && candidate < rawOrder[j - 1]))
            ) {
                rawOrder[j] = rawOrder[j - 1];
                --j;
            }
            rawOrder[j] = candidate;
        }

        bool muscle;
        bool yellow;
        bool wisdom;
        for (uint8 i; i < 3; ++i) {
            uint8 card = acquiredCards[i];
            if (card == 17 || card == 18) muscle = true;
            if (card == 19) yellow = true;
            if (card == 21) wisdom = true;
        }
        versionAnswer = muscle && yellow && wisdom;
        uint8 cursor;
        if (versionAnswer) settlementOrder[cursor++] = playerHorseId;
        for (uint8 i; i < 5; ++i) {
            uint8 horse = rawOrder[i];
            if (horse == playerHorseId) rawRank = i + 1;
            if (!versionAnswer || horse != playerHorseId) settlementOrder[cursor++] = horse;
        }
        settlementRank = versionAnswer ? 1 : rawRank;
    }
}
