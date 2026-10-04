// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";

contract PaidProfilesTest {
    function testFrozenCrossLanguageVector() public pure {
        bytes32 seed = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        bytes32 anchor = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        PaidProfiles.Profile[5] memory p = PaidProfiles.derive(seed, anchor, 2, 1);
        require(p[0].base == 1212 && p[0].acceleration == 14 && p[0].cap == 1913, "group 0");
        require(p[1].base == 1200 && p[1].acceleration == 12 && p[1].cap == 1800, "player");
        require(p[2].base == 1245 && p[2].acceleration == 12 && p[2].cap == 1853, "group 1");
        require(p[3].base == 1237 && p[3].acceleration == 11 && p[3].cap == 1802, "group 2");
        require(p[4].base == 1254 && p[4].acceleration == 14 && p[4].cap == 1786, "group 3");
    }

    function testHalfMonFourthTierVector() public pure {
        bytes32 seed = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        bytes32 anchor = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        PaidProfiles.Profile[5] memory p = PaidProfiles.derive(seed, anchor, 4, 1);
        require(p[0].base == 1332 && p[0].acceleration == 16 && p[0].cap == 2073, "group 0");
        require(p[1].base == 1200 && p[1].acceleration == 12 && p[1].cap == 1800, "player");
        require(p[2].base == 1365 && p[2].acceleration == 14 && p[2].cap == 2013, "group 1");
        require(p[3].base == 1357 && p[3].acceleration == 13 && p[3].cap == 1962, "group 2");
        require(p[4].base == 1374 && p[4].acceleration == 16 && p[4].cap == 1946, "group 3");
    }
}
