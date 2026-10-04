// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidCardRules} from "../../contracts/libraries/PaidCardRules.sol";
import {PaidRaceCold} from "../../contracts/libraries/PaidRaceCold.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";

/// @dev Test-only adapter for the archived v4 vectors. It deliberately does not enable role rules
/// (`core.ponyAbilities = false`), so the engine replays the no-roster rules a v4 deployment saw.
/// Production PaidRaceSolver has a required roster and never uses this adapter.
contract LegacyCoreSolverProbe is IPaidRaceSolver {
    function rulesetHash() external pure returns (bytes32) {
        return PaidCardRules.LEGACY_RULESET_HASH;
    }

    function solve(RaceInput calldata input) external pure returns (RaceResult memory) {
        PaidRaceEngine.CoreInput memory core;
        (core.profiles, core.playerDeck, core.cpuDecks) =
            PaidRaceCold.derive(input.seed, input.openAnchor, input.stakeTier, input.playerHorseId);
        core.playerHorseId = input.playerHorseId;
        core.seed = input.seed;
        core.openAnchor = input.openAnchor;
        core.choices = input.choices;
        core.ponyAbilities = false;
        return PaidRaceEngine.solveRace(core);
    }
}
