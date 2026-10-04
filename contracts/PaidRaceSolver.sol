// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "./interfaces/IPaidRaceSolver.sol";
import {PaidCardRules} from "./libraries/PaidCardRules.sol";
import {PaidRaceEngine} from "./libraries/PaidRaceEngine.sol";
import {PaidRaceCold} from "./libraries/PaidRaceCold.sol";

/// @notice Stateless roster-aware solver. Derives personalities and decks from the opening anchor
/// (src/race/paid/race.ts derivePaidCoreInput) and runs PaidRaceEngine, the bit-exact port of the TS reference.
/// @dev Engine/Motion/watch/gated and the cold-path domain libraries are compiled into this contract.
/// No helper contract is created or linked; scripts/check-contract-sizes.ts gates the Monad deployment limits.
contract PaidRaceSolver is IPaidRaceSolver {
    function rulesetHash() external pure returns (bytes32) {
        return PaidCardRules.RULESET_HASH;
    }

    /// @inheritdoc IPaidRaceSolver
    function solve(RaceInput calldata input) external pure returns (RaceResult memory result) {
        return PaidRaceEngine.solveRace(coreInput(input));
    }

    /// @notice derivePaidCoreInput: opening-anchor personalities, the 14-card player deck and the CPU 3-card decks.
    function coreInput(RaceInput calldata input) internal pure returns (PaidRaceEngine.CoreInput memory core) {
        (core.profiles, core.playerDeck, core.cpuDecks) =
            PaidRaceCold.derive(input.seed, input.openAnchor, input.stakeTier, input.playerHorseId);
        core.playerHorseId = input.playerHorseId;
        core.seed = input.seed;
        core.openAnchor = input.openAnchor;
        core.choices = input.choices;
        core.roster = input.roster;
        core.ponyAbilities = true;
    }
}
