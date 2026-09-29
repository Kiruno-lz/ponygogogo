// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/IPaidRaceSolver.sol";

/// @notice Configurable stand-in for PaidRaceSolver so the session protocol is testable without the race rules.
/// @dev `solve` asserts the input shape IPaidRaceSolver promises (seed and every present choice's anchor sealed or
/// read), so a Game that builds a wrong RaceInput fails loudly, and hashes the whole input into `digest`, letting
/// tests prove which input the Game passed. Stored choices are taken as given (acquired = cardId of each present
/// choice). Also deployed by the keeper L2 test.
contract MockPaidRaceSolver is IPaidRaceSolver {
    error MockBadInput(uint8 code);
    error MockSolveFailed();

    bytes32 public immutable rulesetHash;
    bool public solveReverts;
    /// @notice Burn all gas instead of returning (a solver that cannot finish within any budget).
    bool public solveExhaustsGas;
    /// @notice Burn about this much gas before returning normally (a heavy but working solve).
    uint256 public solveGasBurn;
    /// @notice Return a rank that disagrees with settlementOrder.
    bool public corruptResult;
    uint8 public rawRank = 1;
    uint8 public settlementRank = 1;
    uint32 public finishWall = 60_000;

    constructor(bytes32 rulesetHash_) {
        rulesetHash = rulesetHash_;
    }

    function setSolveReverts(bool value) external {
        solveReverts = value;
    }

    function setSolveExhaustsGas(bool value) external {
        solveExhaustsGas = value;
    }

    function setSolveGasBurn(uint256 value) external {
        solveGasBurn = value;
    }

    function setCorruptResult(bool value) external {
        corruptResult = value;
    }

    /// @notice Player finishes at raw rank `raw` and settlement rank `settled` (1..5), `wallMs` after T0.
    function setOutcome(uint8 raw, uint8 settled, uint32 wallMs) external {
        rawRank = raw;
        settlementRank = settled;
        finishWall = wallMs;
    }

    function solve(RaceInput calldata input) external view returns (RaceResult memory result) {
        _checkCommon(input);
        for (uint256 i; i < 3; ++i) {
            if (input.choices[i].present && input.choices[i].anchor == bytes32(0)) revert MockBadInput(6);
        }
        if (solveReverts) revert MockSolveFailed();
        if (solveExhaustsGas || solveGasBurn != 0) {
            uint256 stop = solveExhaustsGas || solveGasBurn >= gasleft() ? 0 : gasleft() - solveGasBurn;
            uint256 sink;
            while (gasleft() > stop) {
                sink = uint256(keccak256(abi.encode(sink)));
            }
            result.eventCount = uint32(sink);
        }
        uint8 player = input.playerHorseId;
        result.rawOrder = _order(player, rawRank);
        result.settlementOrder = _order(player, settlementRank);
        uint256 offset = uint256(rawRank - 1) * 1000;
        for (uint256 rank; rank < 5; ++rank) {
            uint8 horse = result.rawOrder[rank];
            uint256 wall = uint256(finishWall) + rank * 1000;
            result.finishTime[horse] = uint32(40_000 + rank * 1000);
            result.finishWall[horse] = uint32(wall > offset ? wall - offset : 0);
        }
        result.playerRawRank = rawRank;
        result.playerSettlementRank = corruptResult ? (settlementRank % 5) + 1 : settlementRank;
        for (uint256 i; i < 3; ++i) {
            result.acquired[i] = input.choices[i].present ? input.choices[i].cardId : 0;
        }
        result.eventCount = 7;
        result.digest = keccak256(abi.encode(input));
    }

    function _checkCommon(RaceInput calldata input) private pure {
        if (input.openAnchor == bytes32(0) || input.seed == bytes32(0)) revert MockBadInput(2);
        if (input.stakeTier == 0 || input.stakeTier > 4 || input.playerHorseId > 4) revert MockBadInput(7);
    }

    /// @dev Player at position rank-1, the other horses in ascending id order.
    function _order(uint8 player, uint8 rank) private pure returns (uint8[5] memory order) {
        uint8 next;
        for (uint8 position; position < 5; ++position) {
            if (position == rank - 1) {
                order[position] = player;
                continue;
            }
            if (next == player) ++next;
            order[position] = next++;
        }
    }
}
