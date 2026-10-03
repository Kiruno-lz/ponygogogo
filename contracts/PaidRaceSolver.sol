// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "./IPaidRaceSolver.sol";
import {PaidCardRules} from "./PaidCardRules.sol";
import {PaidRaceEngine} from "./PaidRaceEngine.sol";
import {PaidRaceSupport} from "./PaidRaceSupport.sol";

/// @notice Stateless paid ruleset v4 solver. Derives personalities and decks from the opening anchor
/// (src/race/paid/race.ts derivePaidCoreInput) and runs PaidRaceEngine, the bit-exact port of the TS reference.
/// @dev Derivation, draw rules and settlement live in PaidRaceSupport, created here, to keep this contract under
/// EIP-170.
contract PaidRaceSolver is IPaidRaceSolver {
    PaidRaceSupport public immutable support;

    constructor() {
        support = new PaidRaceSupport();
    }

    function rulesetHash() external pure returns (bytes32) {
        return PaidCardRules.RULESET_HASH;
    }

    /// @inheritdoc IPaidRaceSolver
    function solve(RaceInput calldata input) external view returns (RaceResult memory result) {
        return PaidRaceEngine.solveRace(coreInput(input), support);
    }

    /// @notice derivePaidCoreInput: opening-anchor personalities, the 14-card player deck and the CPU 3-card decks.
    function coreInput(RaceInput calldata input) internal view returns (PaidRaceEngine.CoreInput memory core) {
        (core.profiles, core.playerDeck, core.cpuDecks) =
            support.derive(input.seed, input.openAnchor, input.stakeTier, input.playerHorseId);
        core.playerHorseId = input.playerHorseId;
        core.seed = input.seed;
        core.openAnchor = input.openAnchor;
        core.choices = input.choices;
    }
}
