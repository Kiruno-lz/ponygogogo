// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RaceEntropy} from "../../contracts/libraries/RaceEntropy.sol";

contract RaceEntropyTest {
    function testFrozenCrossLanguageVector() public pure {
        bytes32 seed = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        bytes32 anchor = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        uint256 result = RaceEntropy.derive(seed, anchor, 1, keccak256("card"), 0);
        require(
            result == uint256(0x7279b95b076b3a0cc59823e04694d97c3526a12984d047d80cd54ac4d5d459f7), "vector mismatch"
        );
    }
}
