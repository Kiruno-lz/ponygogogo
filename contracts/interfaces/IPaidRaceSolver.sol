// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stateless race solver. PonyGame fixes one solver (and its rulesetHash) at construction;
/// a rules change deploys a new solver and a new Game.
/// @dev Every function must be pure with respect to its input: no storage writes, no dependence on block context,
/// so that the browser, the keeper and PonyGame agree on the same RaceInput.
interface IPaidRaceSolver {
    /// @dev A stored transaction as PonyGame.chooseCard recorded it, unvalidated: the solve judges it and ignores one
    /// that breaks a rule (有奖规则 v3), logging CHOICE_INVALID into the digest.
    struct ChoiceInput {
        bool present; // a player transaction exists for this checkpoint
        uint32 txSec; // block.timestamp - T0, seconds
        uint8 cardId; // 0 = active forfeit
        uint8[] refreshSlots; // ordered refreshes at this checkpoint
        bytes32 anchor; // blockhash of that tx's block
    }

    struct RaceInput {
        bytes32 seed;
        bytes32 openAnchor;
        uint8 stakeTier; // 1..4
        uint8 playerHorseId; // 0..4
        ChoiceInput[3] choices; // index 0..2 = checkpoints 1..3
        uint8[5] roster; // stable pony identity at each starting participant slot
    }

    struct RaceResult {
        uint32[5] finishTime; // sim ms, 600001 = unfinished
        uint32[5] finishWall; // wall ms relative to T0
        uint8[5] rawOrder;
        uint8[5] settlementOrder;
        uint8 playerRawRank; // 1..5
        uint8 playerSettlementRank; // 1..5
        uint8[3] acquired; // player's acquired card per checkpoint, 0 = none (an ignored choice acquires nothing)
        uint32 eventCount;
        bytes32 digest;
    }

    /// @notice Non-zero immutable rule identifier; generated card-table changes require a new hash.
    function rulesetHash() external view returns (bytes32);

    /// Full race; absent and ignored choices are timeouts/auto/cut as the rules decide. Must not revert because of
    /// any stored choice value.
    /// @dev finishWall[playerHorseId] must be finite even when the player does not finish (wall(600000)), since
    /// PonyGame gates settlement on it. playerSettlementRank must equal the index of playerHorseId in
    /// settlementOrder plus one. A choice sent after the player's canonical finish is ignored, so settling as soon as
    /// now*1000 >= finishWall never races a later choice.
    function solve(RaceInput calldata input) external view returns (RaceResult memory);
}
