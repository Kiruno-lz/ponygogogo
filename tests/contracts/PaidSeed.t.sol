// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidSeed} from "../../contracts/libraries/PaidSeed.sol";

contract PaidSeedTest {
    function testCastVectorAndNonceSeparation() public pure {
        bytes32 seed = PaidSeed.derive(
            10143, 0x1111111111111111111111111111111111111111, 0x2222222222222222222222222222222222222222, 7
        );
        require(seed == 0x722555e6546c117e5a3a3d075ab7201d092809d0314e9b451b2b1fb30eea11ca, "cast vector");
        require(
            PaidSeed.derive(
                10143, 0x1111111111111111111111111111111111111111, 0x2222222222222222222222222222222222222222, 8
            ) != seed,
            "nonce"
        );
    }
}
