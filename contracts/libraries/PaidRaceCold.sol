// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "./PaidCardRules.sol";
import {PaidRaceCardPlan} from "./PaidRaceCardPlan.sol";
import {PaidCpuDeck} from "./PaidCpuDeck.sol";
import {PaidDeck} from "./PaidDeck.sol";
import {PaidDrawRules} from "./PaidDrawRules.sol";
import {PaidProfiles} from "./PaidProfiles.sol";
import {PaidSettlement} from "./PaidSettlement.sol";

/// @notice Cold-path calculations compiled into PaidRaceSolver: derivation, canonical rules, card snapshot
/// decisions, draw transitions and settlement. Engine owns race memory, event scheduling and effect lifecycles.
library PaidRaceCold {
    function raceParams() internal pure returns (uint256[11] memory p) {
        p[0] = PaidCardRules.get(15).staminaMicro;
        p[1] = PaidCardRules.get(12).strengthBps;
        PaidCardRules.Rule memory r = PaidCardRules.get(11);
        p[2] = uint16(r.fixedSpeed);
        p[6] = r.periodMs;
        r = PaidCardRules.get(4);
        p[3] = r.autoPanelSec;
        p[7] = r.bonusBps;
        r = PaidCardRules.get(9);
        p[4] = r.periodMs;
        p[5] = r.count;
        r = PaidCardRules.get(10);
        p[8] = r.radiusMicro;
        p[9] = r.strengthBps;
        p[10] = uint256(int256(r.overlapBps));
    }

    function cardRuleWords(uint8 id) internal pure returns (uint256, uint256) {
        return PaidCardRules.packed(id);
    }

    function newCardPlan(uint8 card, uint8 h, uint256[5] memory horses, uint256[3] memory equipment)
        internal
        pure
        returns (uint256[] memory, uint256)
    {
        return PaidRaceCardPlan.plan(card, h, horses, equipment);
    }

    function derive(bytes32 seed, bytes32 openAnchor, uint8 stakeTier, uint8 playerHorseId)
        internal
        pure
        returns (PaidProfiles.Profile[5] memory profiles, uint8[14] memory deck, uint8[3][5] memory cpuDecks)
    {
        profiles = PaidProfiles.derive(seed, openAnchor, stakeTier, playerHorseId);
        deck = PaidDeck.derive(seed, openAnchor);
        for (uint8 h; h < 5; ++h) {
            if (h != playerHorseId) cpuDecks[h] = PaidCpuDeck.derive(seed, openAnchor, h);
        }
    }

    /// @notice classifyPaidDraw for a stored choice when its manual panel opens: 0 = legal, else INVALID_*.
    function classifyChoice(
        uint8[14] memory deck,
        PaidDrawRules.State memory state,
        uint8[] memory refreshSlots,
        uint8 chosenId
    ) internal pure returns (uint8) {
        return PaidDrawRules.classify(deck, state, refreshSlots, chosenId);
    }

    /// @notice One panel close: resolvePaidAutomaticChoice from `sealedAnchor` when the draw state is automatic (the
    /// panel opened in auto mode; the state only changes at a close), else applyPaidChoice with the transaction's
    /// refreshes and card, where no card and no refreshes is also the timeout. The engine only passes a stored choice
    /// that classifyChoice accepted when the panel opened, so this never reverts for a solve.
    function closePanel(
        uint8[14] memory deck,
        PaidDrawRules.State memory state,
        uint8[] memory refreshSlots,
        uint8 chosenId,
        bytes32 seed,
        bytes32 sealedAnchor,
        uint8 checkpoint
    ) internal pure returns (PaidDrawRules.State memory next, uint8 cardId) {
        if (state.automatic) {
            return PaidDrawRules.automaticChoice(deck, state, seed, sealedAnchor, checkpoint);
        }
        return (PaidDrawRules.applyChoice(deck, state, refreshSlots, chosenId), chosenId);
    }

    function settle(uint32[5] memory finishMs, uint8 playerHorseId, uint8[3] memory acquired)
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
        return PaidSettlement.resolve(finishMs, playerHorseId, acquired);
    }
}
