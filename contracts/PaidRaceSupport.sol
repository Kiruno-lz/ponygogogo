// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "./libraries/PaidCardRules.sol";
import {PaidRaceMotion} from "./libraries/PaidRaceMotion.sol";
import {PaidRaceCardPlan} from "./libraries/PaidRaceCardPlan.sol";
import {PaidCpuDeck} from "./libraries/PaidCpuDeck.sol";
import {PaidDeck} from "./libraries/PaidDeck.sol";
import {PaidDrawRules} from "./libraries/PaidDrawRules.sol";
import {PaidProfiles} from "./libraries/PaidProfiles.sol";
import {PaidSettlement} from "./libraries/PaidSettlement.sol";

/// @notice Stateless numeric and card support for PaidRaceSolver: canonical card words, snapshot decisions,
/// motion stretches, deck/choice derivation and settlement. The engine owns the ordered event lifecycle.
/// Keeping these pure operations here keeps both deployable contracts within EIP-170.
contract PaidRaceSupport {
    function raceParams() external pure returns (uint256[11] memory p) {
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

    function gatedModifiers(uint8 card, bool air, bool wired, bool equipped, uint32 coat)
        external
        pure
        returns (int256 p, uint256 regen)
    {
        PaidCardRules.Rule memory r = PaidCardRules.get(card);
        p = r.pBps;
        if (card == 26 && wired) {
            p += int256(uint256(r.bonusBps));
        } else if (card == 27 && air) {
            p += int256(uint256(r.bonusBps));
        } else if (card == 28 && air) {
            p = 0;
        } else if (card == 29) {
            if (coat == PaidCardRules.get(20).coatRgb) {
                p = 0;
                regen = r.regenBonusBps;
            } else if (coat != PaidCardRules.get(19).coatRgb) {
                p = r.fallbackBps;
            }
        } else if (card == 33 && equipped) {
            p = r.fallbackBps;
        }
    }

    function watchTrigger(uint8 card, uint8 count, uint32 start, uint32 now_, uint256[4] memory h)
        external
        pure
        returns (uint256)
    {
        PaidCardRules.Rule memory r = PaidCardRules.get(card);
        if (card == 23 && count == 0) return uint256(start) + r.periodMs;
        if (card == 24) {
            if (h[0] <= r.thresholdMicro) return now_;
            if (h[3] >> 128 == 0 && h[1] > h[2]) {
                uint256 d = h[1] - h[2];
                return uint256(now_) + (h[0] - r.thresholdMicro + d - 1) / d;
            }
        }
        if (card == 40 && count < r.count && uint64(h[3]) >= uint64(h[3] >> 64)) return now_;
        return PaidRaceMotion.NEVER;
    }

    function cardRuleWords(uint8 id) external pure returns (uint256, uint256) {
        return PaidCardRules.packed(id);
    }

    function newCardPlan(uint8 card, uint8 h, uint256[5] memory horses, uint256[3] memory equipment)
        external
        pure
        returns (uint256[] memory, uint256)
    {
        return PaidRaceCardPlan.plan(card, h, horses, equipment);
    }

    /// @dev Flat words preserve signed fields and avoid a second structured ABI for the hot motion state.
    /// The engine supplies exactly five 40-word Horses. Memory references are rebuilt locally, never transported.
    function refresh(
        uint256[200] memory words,
        uint256[5] memory live,
        uint256[80] memory bombWords,
        int256 wind,
        uint256 placer,
        uint256 tau
    ) external pure returns (uint256[200] memory, uint256 next) {
        PaidRaceMotion.Horse[5] memory horses;
        PaidRaceMotion.Bomb[20] memory bombs;
        for (uint256 h; h < 5; ++h) {
            assembly ("memory-safe") { mstore(add(horses, shl(5, h)), add(words, mul(h, 0x500))) }
        }
        for (uint256 b; b < 20; ++b) {
            assembly ("memory-safe") { mstore(add(bombs, shl(5, b)), add(bombWords, shl(7, b))) }
        }
        PaidRaceMotion.Stretch memory sx;
        sx.wind = wind;
        sx.windPlacer = placer;
        next = PaidRaceMotion.refresh(horses, sx, live, bombs, tau);
        return (words, next);
    }

    function advance(
        uint256[200] memory words,
        uint8[] memory owners,
        uint256[3] memory field,
        uint256 tau,
        uint256 horizon
    ) external pure returns (uint256[200] memory, uint256 t, bool cut, uint256 steps) {
        PaidRaceMotion.Horse[5] memory horses;
        PaidRaceMotion.Stretch memory sx;
        sx.radius = field[0];
        sx.strength = field[1];
        sx.overlap = int256(field[2]);
        for (uint256 h; h < 5; ++h) {
            PaidRaceMotion.Horse memory horse;
            assembly ("memory-safe") {
                horse := add(words, mul(h, 0x500))
                mstore(add(horses, shl(5, h)), horse)
            }
            if (horse.finished) continue;
            uint256 n = sx.runCount++;
            assembly ("memory-safe") { mstore(add(sx, add(0x20, shl(5, n))), horse) }
        }
        sx.ownerCount = owners.length;
        for (uint256 i; i < owners.length; ++i) {
            PaidRaceMotion.setOwner(sx, i, horses[owners[i]]);
        }
        (t, cut) = PaidRaceMotion.advance(sx, tau, horizon);
        return (words, t, cut, sx.steps);
    }

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
