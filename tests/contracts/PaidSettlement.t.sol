// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidSettlement} from "../../contracts/PaidSettlement.sol";

contract PaidSettlementTest {
    function testPhysicalTieAndVersionAnswer() public pure {
        uint32[5] memory times = [uint32(12), 12, 11, 13, 12];
        uint8[3] memory cards = [uint8(17), 19, 21];
        (uint8[5] memory raw, uint8[5] memory settled, uint8 rawRank, uint8 settlementRank, bool active) =
            PaidSettlement.resolve(times, 4, cards);
        require(raw[0] == 2 && raw[1] == 0 && raw[2] == 1 && raw[3] == 4 && raw[4] == 3, "raw");
        require(settled[0] == 4 && settled[1] == 2 && settled[2] == 0 && settled[3] == 1 && settled[4] == 3, "settled");
        require(rawRank == 4 && settlementRank == 1 && active, "rank");
    }

    function testMissingComponentKeepsPhysicalOrder() public pure {
        uint32[5] memory times = [uint32(61), 63, 62, 64, 65];
        uint8[3] memory cards = [uint8(17), 19, 20];
        (uint8[5] memory raw, uint8[5] memory settled, uint8 rawRank, uint8 settlementRank, bool active) =
            PaidSettlement.resolve(times, 3, cards);
        require(raw[0] == 0 && raw[1] == 2 && raw[2] == 1 && raw[3] == 3 && raw[4] == 4, "raw");
        require(settled[0] == 0 && settled[1] == 2 && settled[2] == 1 && settled[3] == 3 && settled[4] == 4, "settled");
        require(rawRank == 4 && settlementRank == 4 && !active, "rank");
    }
}
