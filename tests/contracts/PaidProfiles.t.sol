// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";
import {PlayerBalance} from "../../contracts/libraries/PlayerBalance.sol";
import {LegacyPaidProfiles} from "./legacy/LegacyPaidProfiles.sol";

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

    /// @dev The archived no-roster personalities replayed by LegacyCoreSolverProbe.
    function testLegacyTierVectors() public pure {
        PaidProfiles.Profile[5] memory p = LegacyPaidProfiles.derive(SEED, ANCHOR, 2, 1);
        require(p[0].base == 1212 && p[0].acceleration == 14 && p[0].cap == 1913, "tier 2 group 0");
        require(p[1].base == 1200 && p[1].acceleration == 12 && p[1].cap == 1800, "legacy player");
        require(p[2].base == 1245 && p[2].acceleration == 12 && p[2].cap == 1853, "tier 2 group 1");
        require(p[3].base == 1237 && p[3].acceleration == 11 && p[3].cap == 1802, "tier 2 group 2");
        require(p[4].base == 1254 && p[4].acceleration == 14 && p[4].cap == 1786, "tier 2 group 3");
        p = LegacyPaidProfiles.derive(SEED, ANCHOR, 4, 1);
        require(p[0].base == 1332 && p[0].acceleration == 16 && p[0].cap == 2073, "tier 4 group 0");
        require(p[2].base == 1365 && p[2].acceleration == 14 && p[2].cap == 2013, "tier 4 group 1");
        require(p[3].base == 1357 && p[3].acceleration == 13 && p[3].cap == 1962, "tier 4 group 2");
        require(p[4].base == 1374 && p[4].acceleration == 16 && p[4].cap == 1946, "tier 4 group 3");
    }
}
