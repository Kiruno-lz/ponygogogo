// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "./PaidCardRules.sol";
import {RaceEntropy} from "./RaceEntropy.sol";

/// @notice Replayable draw-rule state. Game must prove the selected card and anchor came from real transactions.
library PaidDrawRules {
    error ChoiceDisabled();
    error NoRefreshCredit();
    error AutomaticChoiceDisabled();
    error InvalidRefresh();
    error DeckExhausted();
    error CardNotOffered();

    bytes32 internal constant AUTOPICK_DOMAIN = keccak256("autopick");

    /// @dev CHOICE_INVALID reasons classify() returns (src/race/paid/events.ts INVALID_*).
    uint8 internal constant INVALID_AUTO = 5;
    uint8 internal constant INVALID_CUT = 6;
    uint8 internal constant INVALID_NO_CREDIT = 7;
    uint8 internal constant INVALID_BAD_SLOT = 8;
    uint8 internal constant INVALID_EXHAUSTED = 9;
    uint8 internal constant INVALID_NOT_OFFERED = 10;

    struct State {
        uint8 cursor;
        uint8 tailCursor;
        uint8 refreshCredits;
        bool automatic;
        bool forfeited;
    }

    function initial() internal pure returns (State memory) {
        return State(0, 14, 0, false, false);
    }

    function applyChoice(uint8[14] memory deck, State memory state, uint8[] memory refreshSlots, uint8 chosenId)
        internal
        pure
        returns (State memory)
    {
        if (state.automatic || state.forfeited) revert ChoiceDisabled();
        if (refreshSlots.length > state.refreshCredits) revert NoRefreshCredit();
        (uint8 nextCursor, uint8[3] memory candidates) = _offer(deck, state.cursor);
        uint8 refreshed;
        for (uint256 i; i < refreshSlots.length; ++i) {
            uint8 slot = refreshSlots[i];
            if (slot > 2 || refreshed & (uint8(1) << slot) != 0) revert InvalidRefresh();
            if (state.tailCursor <= nextCursor) revert DeckExhausted();
            candidates[slot] = deck[--state.tailCursor];
            refreshed |= uint8(1) << slot;
        }
        if (chosenId != 0 && chosenId != candidates[0] && chosenId != candidates[1] && chosenId != candidates[2]) {
            revert CardNotOffered();
        }
        state.cursor = nextCursor;
        state.refreshCredits -= uint8(refreshSlots.length);
        return _applyCard(state, chosenId);
    }

    /// @notice classifyPaidDraw: 0 when applyChoice would accept the refreshes and card, else the INVALID_* code of
    /// the first rule it breaks, in applyChoice's own order (有奖规则 v3). Cut is judged before auto. Never reverts.
    function classify(uint8[14] memory deck, State memory state, uint8[] memory refreshSlots, uint8 chosenId)
        internal
        pure
        returns (uint8)
    {
        if (state.forfeited) return INVALID_CUT;
        if (state.automatic) return INVALID_AUTO;
        if (refreshSlots.length > state.refreshCredits) return INVALID_NO_CREDIT;
        uint256 cursor = state.cursor;
        if (cursor > 11) return INVALID_EXHAUSTED;
        uint256 nextCursor = cursor + 3;
        uint8[3] memory candidates = [deck[cursor], deck[cursor + 1], deck[cursor + 2]];
        uint256 tail = state.tailCursor;
        uint256 refreshed;
        for (uint256 i; i < refreshSlots.length; ++i) {
            uint256 slot = refreshSlots[i];
            if (slot > 2 || (refreshed >> slot) & 1 != 0) return INVALID_BAD_SLOT;
            if (tail <= nextCursor) return INVALID_EXHAUSTED;
            candidates[slot] = deck[--tail];
            refreshed |= uint256(1) << slot;
        }
        if (chosenId != 0 && chosenId != candidates[0] && chosenId != candidates[1] && chosenId != candidates[2]) {
            return INVALID_NOT_OFFERED;
        }
        return 0;
    }

    function automaticChoice(
        uint8[14] memory deck,
        State memory state,
        bytes32 seed,
        bytes32 sealedAnchor,
        uint8 checkpoint
    ) internal pure returns (State memory, uint8 cardId) {
        if (!state.automatic || state.forfeited) revert AutomaticChoiceDisabled();
        (uint8 nextCursor, uint8[3] memory offered) = _offer(deck, state.cursor);
        uint256 index = RaceEntropy.derive(seed, sealedAnchor, checkpoint, AUTOPICK_DOMAIN, 0) % 3;
        cardId = offered[index];
        state.cursor = nextCursor;
        return (_applyCard(state, cardId), cardId);
    }

    function _applyCard(State memory state, uint8 cardId) private pure returns (State memory) {
        if (cardId == 0) return state;
        PaidCardRules.Rule memory rule = PaidCardRules.get(cardId);
        if (rule.effect == PaidCardRules.EFFECT_REFRESH) state.refreshCredits += rule.count;
        if (rule.effect == PaidCardRules.EFFECT_DRAW_AUTO) state.automatic = true;
        if (rule.effect == PaidCardRules.EFFECT_DRAW_CUT) state.forfeited = true;
        return state;
    }

    function _offer(uint8[14] memory deck, uint8 cursor)
        private
        pure
        returns (uint8 nextCursor, uint8[3] memory candidates)
    {
        if (cursor > 11) revert DeckExhausted();
        candidates = [deck[cursor], deck[cursor + 1], deck[cursor + 2]];
        nextCursor = cursor + 3;
    }
}
