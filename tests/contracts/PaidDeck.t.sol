// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidDeck} from "../../contracts/PaidDeck.sol";

contract PaidDeckTest {
    function deriveForMask(uint256 mask) external pure {
        bytes32 seed = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        bytes32 anchor = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        PaidDeck.derive(seed, anchor, mask);
    }

    function testFullPoolProducesFourteenUniqueCardsWithRareTail() public pure {
        bytes32 seed = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        bytes32 anchor = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        uint8[14] memory deck = PaidDeck.derive(seed, anchor);
        uint8[14] memory expected = [uint8(19), 35, 12, 34, 10, 14, 26, 6, 18, 3, 17, 37, 30, 21];
        uint256 seen;
        for (uint256 i; i < 14; ++i) {
            require(deck[i] == expected[i], "deck vector");
            require(deck[i] >= 1 && deck[i] <= 40, "card range");
            uint256 bit = 1 << (deck[i] - 1);
            require(seen & bit == 0, "duplicate card");
            seen |= bit;
            if (i >= 12) require(PaidDeck.RARE_MASK & bit != 0, "rare tail");
        }
    }

    function testFourteenCommonCardsStillNeedTwoEligibleRareCards() public {
        uint256 commonOnly = PaidDeck.FULL_MASK & ~PaidDeck.RARE_MASK;
        (bool ok,) = address(this).call(abi.encodeCall(this.deriveForMask, (commonOnly)));
        require(!ok, "common-only deck accepted");
    }
}
