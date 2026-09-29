// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCpuDeck} from "./PaidCpuDeck.sol";
import {PaidDeck} from "./PaidDeck.sol";
import {PaidDrawRules} from "./PaidDrawRules.sol";
import {PaidProfiles} from "./PaidProfiles.sol";
import {PaidSettlement} from "./PaidSettlement.sol";

/// @notice The parts of a paid-race solve that run a handful of times per race: the opening-anchor derivation
/// (src/race/paid/race.ts derivePaidCoreInput), the stored-choice judgement and the player's draw-rule transitions
/// (at most three each per race) and the settlement ranking (once). PaidRaceSolver creates one in its constructor and calls it, which keeps the solver
/// under the EIP-170 code size limit. Stateless and pure; reverts bubble up unchanged through the solver.
contract PaidRaceSupport {
    function derive(bytes32 seed, bytes32 openAnchor, uint8 stakeTier, uint8 playerHorseId)
        external
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
        uint8[14] calldata deck,
        PaidDrawRules.State calldata state,
        uint8[] calldata refreshSlots,
        uint8 chosenId
    ) external pure returns (uint8) {
        return PaidDrawRules.classify(deck, state, refreshSlots, chosenId);
    }

    /// @notice One panel close: resolvePaidAutomaticChoice from `sealedAnchor` when the draw state is automatic (the
    /// panel opened in auto mode; the state only changes at a close), else applyPaidChoice with the transaction's
    /// refreshes and card, where no card and no refreshes is also the timeout. The engine only passes a stored choice
    /// that classifyChoice accepted when the panel opened, so this never reverts for a solve.
    function closePanel(
        uint8[14] calldata deck,
        PaidDrawRules.State calldata state,
        uint8[] calldata refreshSlots,
        uint8 chosenId,
        bytes32 seed,
        bytes32 sealedAnchor,
        uint8 checkpoint
    ) external pure returns (PaidDrawRules.State memory next, uint8 cardId) {
        if (state.automatic) {
            return PaidDrawRules.automaticChoice(deck, state, seed, sealedAnchor, checkpoint);
        }
        return (PaidDrawRules.applyChoice(deck, state, refreshSlots, chosenId), chosenId);
    }

    function settle(uint32[5] calldata finishMs, uint8 playerHorseId, uint8[3] calldata acquired)
        external
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
