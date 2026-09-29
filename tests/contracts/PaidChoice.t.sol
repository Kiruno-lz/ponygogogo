// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidChoice} from "../../contracts/PaidChoice.sol";

contract PaidChoiceTest {
    function _deck() private pure returns (uint8[14] memory) {
        return [uint8(9), 24, 15, 12, 23, 21, 25, 16, 11, 18, 20, 10, 5, 2];
    }

    function testRefreshAndChoiceVector() public pure {
        uint8[] memory refresh = new uint8[](1);
        refresh[0] = 1;
        (uint8 nextCursor, uint8[3] memory candidates) = PaidChoice.consume(_deck(), 0, refresh, 12);
        require(nextCursor == 4, "cursor");
        require(candidates[0] == 9 && candidates[1] == 12 && candidates[2] == 15, "candidates");
    }

    function replay(uint8 cursor, uint8[] memory refresh, uint8 chosenId) external pure {
        PaidChoice.consume(_deck(), cursor, refresh, chosenId);
    }

    function testRejectStaleCardRepeatedRefreshAndExhaustedDeck() public {
        uint8[] memory refresh = new uint8[](1);
        refresh[0] = 1;
        (bool stale,) = address(this).call(abi.encodeCall(this.replay, (uint8(0), refresh, uint8(24))));
        uint8[] memory repeated = new uint8[](2);
        repeated[0] = 1;
        repeated[1] = 1;
        (bool duplicate,) = address(this).call(abi.encodeCall(this.replay, (uint8(0), repeated, uint8(12))));
        uint8[] memory none = new uint8[](0);
        (bool exhausted,) = address(this).call(abi.encodeCall(this.replay, (uint8(12), none, uint8(5))));
        require(!stale && !duplicate && !exhausted, "invalid choice accepted");
    }
}
