// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RacePayout} from "../../contracts/RacePayout.sol";

contract RacePayoutTest {
    function testGrossIncludesPrincipalAndRoundsDown() public pure {
        require(RacePayout.gross(3, 15_000) == 4, "rounding");
        require(RacePayout.gross(100, 10_000) == 100, "principal");
        require(RacePayout.gross(100, 0) == 0, "loss");
    }

    function testMaximumPayoutUsesEntireFrozenRankTable() public pure {
        uint16[5] memory multipliers = [uint16(30_000), 15_000, 10_000, 0, 0];
        require(RacePayout.maximum(5_000_000, multipliers) == 15_000_000, "maximum");
    }

    function testMulDivHandlesLargeStakeWithoutIntermediateOverflow() public pure {
        uint256 stake = type(uint256).max / 30_000;
        require(RacePayout.gross(stake, 30_000) == stake * 3, "large stake");
    }
}
