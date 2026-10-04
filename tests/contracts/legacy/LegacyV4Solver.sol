// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ILegacyPaidRaceSolver} from "./ILegacyPaidRaceSolver.sol";
import {IPaidRaceSolver} from "../../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidCardRules} from "../../../contracts/libraries/PaidCardRules.sol";

/// @dev Actual pre-roster five-field ABI, backed by the vector-verified legacy core.
contract LegacyV4Solver is ILegacyPaidRaceSolver {
    IPaidRaceSolver public immutable legacyCore;

    constructor(IPaidRaceSolver legacyCore_) {
        legacyCore = legacyCore_;
    }

    function rulesetHash() external pure returns (bytes32) {
        return PaidCardRules.LEGACY_RULESET_HASH;
    }

    function solve(RaceInput calldata input) external view returns (RaceResult memory) {
        IPaidRaceSolver.RaceInput memory core;
        core.playerHorseId = input.playerHorseId;
        core.stakeTier = input.stakeTier;
        core.seed = input.seed;
        core.openAnchor = input.openAnchor;
        for (uint256 i; i < 3; ++i) {
            ChoiceInput calldata c = input.choices[i];
            core.choices[i] = IPaidRaceSolver.ChoiceInput(c.present, c.txSec, c.cardId, c.refreshSlots, c.anchor);
        }
        IPaidRaceSolver.RaceResult memory r = legacyCore.solve(core);
        return RaceResult(
            r.finishTime,
            r.finishWall,
            r.rawOrder,
            r.settlementOrder,
            r.playerRawRank,
            r.playerSettlementRank,
            r.acquired,
            r.eventCount,
            r.digest
        );
    }
}
