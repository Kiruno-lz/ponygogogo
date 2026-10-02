// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCpuDeck} from "../../contracts/PaidCpuDeck.sol";

contract PaidCpuDeckTest {
    function testCrossLanguageVectorsAndNoDuplicates() public pure {
        bytes32 seed = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        bytes32 anchor = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        uint8[3] memory first = PaidCpuDeck.derive(seed, anchor, 0);
        uint8[3] memory second = PaidCpuDeck.derive(seed, anchor, 1);
        require(first[0] == 8 && first[1] == 30 && first[2] == 2, "first horse");
        require(second[0] == 23 && second[1] == 1 && second[2] == 40, "second horse");
        for (uint8 horse; horse < 5; ++horse) {
            uint8[3] memory cards = PaidCpuDeck.derive(seed, anchor, horse);
            require(cards[0] != cards[1] && cards[0] != cards[2] && cards[1] != cards[2], "duplicate card");
        }
    }
}
