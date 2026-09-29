// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidDrawRules} from "../../contracts/PaidDrawRules.sol";

contract PaidDrawRulesTest {
    function testTreasureRefreshAndForfeit() public pure {
        uint8[14] memory deck = [uint8(5), 4, 3, 17, 19, 21, 6, 7, 8, 9, 10, 11, 12, 18];
        PaidDrawRules.State memory state = PaidDrawRules.initial();
        uint8[] memory none = new uint8[](0);
        state = PaidDrawRules.applyChoice(deck, state, none, 5);
        require(state.cursor == 3 && state.refreshCredits == 1, "treasure");
        uint8[] memory refresh = new uint8[](1);
        refresh[0] = 1;
        state = PaidDrawRules.applyChoice(deck, state, refresh, 18);
        require(state.cursor == 6 && state.tailCursor == 13 && state.refreshCredits == 0, "rare refresh");
        PaidDrawRules.State memory ripple = PaidDrawRules.applyChoice(deck, PaidDrawRules.initial(), none, 3);
        require(ripple.forfeited && ripple.cursor == 3, "ripple");
    }

    function testAutomaticChoiceUsesLockedAnchor() public pure {
        uint8[14] memory deck = [uint8(5), 4, 3, 17, 19, 21, 6, 7, 8, 9, 10, 11, 12, 18];
        uint8[] memory none = new uint8[](0);
        PaidDrawRules.State memory state = PaidDrawRules.applyChoice(deck, PaidDrawRules.initial(), none, 4);
        require(state.automatic, "auto enabled");
        (PaidDrawRules.State memory next, uint8 card) = PaidDrawRules.automaticChoice(
            deck,
            state,
            bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111)),
            bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222)),
            2
        );
        require(card == 21, "autopick vector");
        require(next.cursor == 6, "cursor");
    }
}
