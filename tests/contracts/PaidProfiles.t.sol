// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";
import {PlayerBalance} from "../../contracts/libraries/PlayerBalance.sol";

contract PaidProfilesTest {
    bytes32 internal constant SEED =
        bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
    bytes32 internal constant ANCHOR =
        bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));

    function derive(uint8 stakeTier, uint8 playerHorseId) external pure returns (PaidProfiles.Profile[5] memory) {
        return PaidProfiles.derive(SEED, ANCHOR, stakeTier, playerHorseId);
    }

    function testFrozenCrossLanguageVector() public pure {
        PaidProfiles.Profile[5] memory p = PaidProfiles.derive(SEED, ANCHOR, 2, 1);
        uint32[5] memory caps = [uint32(2186), 1800, 2200, 2149, 2221];
        for (uint256 h; h < 5; ++h) {
            require(p[h].base == 300 && p[h].acceleration == 150 && p[h].cap == caps[h], "player baseline + cap offset");
        }
    }

    function testStakeTierDoesNotShapeProfiles() public pure {
        bytes32 tier2 = keccak256(abi.encode(PaidProfiles.derive(SEED, ANCHOR, 2, 3)));
        for (uint8 tier = 1; tier <= 4; ++tier) {
            require(keccak256(abi.encode(PaidProfiles.derive(SEED, ANCHOR, tier, 3))) == tier2, "tier independent");
        }
    }

    function testRejectsInvalidTierAndHorse() public view {
        (bool ok,) = address(this).staticcall(abi.encodeCall(this.derive, (0, 1)));
        require(!ok, "tier 0 accepted");
        (ok,) = address(this).staticcall(abi.encodeCall(this.derive, (5, 1)));
        require(!ok, "tier 5 accepted");
        (ok,) = address(this).staticcall(abi.encodeCall(this.derive, (1, 5)));
        require(!ok, "horse 5 accepted");
    }

    function testFuzzCpuCapsStayInOffsetRange(bytes32 seed, bytes32 anchor, uint8 player) public pure {
        player %= 5;
        PaidProfiles.Profile[5] memory p = PaidProfiles.derive(seed, anchor, 1, player);
        for (uint256 h; h < 5; ++h) {
            require(p[h].base == PlayerBalance.START_SPEED && p[h].acceleration == PlayerBalance.ACCELERATION, "base");
            if (h == player) {
                require(p[h].cap == PlayerBalance.SPEED_CAP, "player cap");
                continue;
            }
            require(p[h].cap >= PlayerBalance.SPEED_CAP + PlayerBalance.CPU_CAP_OFFSET_MIN, "cap below range");
            require(p[h].cap <= PlayerBalance.SPEED_CAP + PlayerBalance.CPU_CAP_OFFSET_MAX, "cap above range");
        }
    }


}
