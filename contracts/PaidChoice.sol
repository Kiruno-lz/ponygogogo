// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Replays one player offer. The Game must enforce refresh credits.
library PaidChoice {
    error DeckExhausted();
    error InvalidRefresh();
    error CardNotOffered();

    function consume(uint8[14] memory deck, uint8 cursor, uint8[] memory refreshSlots, uint8 chosenId)
        internal
        pure
        returns (uint8 nextCursor, uint8[3] memory candidates)
    {
        if (cursor > 11) revert DeckExhausted();
        for (uint8 i; i < 3; ++i) {
            candidates[i] = deck[cursor + i];
        }
        nextCursor = cursor + 3;
        uint8 refreshed;
        for (uint256 i; i < refreshSlots.length; ++i) {
            uint8 slot = refreshSlots[i];
            uint8 bit = uint8(1 << slot);
            if (slot > 2 || refreshed & bit != 0 || nextCursor >= 14) revert InvalidRefresh();
            candidates[slot] = deck[nextCursor++];
            refreshed |= bit;
        }
        if (chosenId != 0 && chosenId != candidates[0] && chosenId != candidates[1] && chosenId != candidates[2]) {
            revert CardNotOffered();
        }
    }
}
