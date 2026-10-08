// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidRaceMotion} from "../../contracts/libraries/PaidRaceMotion.sol";
import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";
import {PonyRules} from "../../contracts/libraries/PonyRules.sol";

contract RoleConvergenceTest {
    function testCpuDeathUsesRecoveryAccelerationWhilePreservingItsProfile() public pure {
        PaidRaceEngine.State memory st;
        PaidProfiles.Profile[5] memory profiles;
        for (uint256 i; i < 5; ++i) {
            profiles[i] = PaidProfiles.Profile(1200, 12, 1800);
        }
        PaidRaceMotion.initHorses(st.horses, profiles, st.ponyWords, 600001, 0);
        PaidRaceMotion.Horse memory h = st.horses[1];
        h.b = h.capMilli;
        h.atCap = true;
        PaidRaceEngine._kill(st, 1, 0);
        PaidRaceMotion.refresh(st.horses, st.stretch, st.laneLive, st.bombs, 0);
        require(h.aEff == 150 && h.accel == 12 && h.recoveryAccel == 150, "CPU recovery/profile");
        require(
            h.exhaustRelease == 135000000 && h.exhaustRegen == 15000 && h.exhaustCapMilli == 1200000,
            "CPU fatigue rules"
        );
        PaidRaceMotion.advance(st.stretch, 0, 12000);
        require(h.b == 1800000 && h.pos == 10800000000, "CPU recovery distance");
    }

    function testCpuExhaustionExitAndBaseRecoveryUseProductionSolver() public pure {
        PaidRaceEngine.CoreInput memory input;
        input.playerHorseId = 0;
        input.ponyAbilities = true;
        input.roster = [uint8(4), 1, 0, 2, 3];
        input.playerDeck = [uint8(17), 18, 21, 14, 19, 15, 20, 1, 2, 6, 7, 8, 10, 12];
        for (uint256 i; i < 5; ++i) {
            input.profiles[i] = PaidProfiles.Profile(300, 150, 1800);
            input.cpuDecks[i] = [uint8(19), 20, 5];
        }
        input.profiles[1] = PaidProfiles.Profile(1000, 0, 1800);
        input.cpuDecks[1] = [uint8(26), 22, 19];
        PaidRaceEngine.Result memory r = PaidRaceEngine.solve(input, PaidRaceEngine.Options(0, false, 0, true));
        uint256 entered;
        uint256 exited;
        uint256 regained;
        for (uint256 i; i < r.eventCount; ++i) {
            uint256 meta = r.eventMeta[i];
            if (uint8(meta >> 40) != 1) continue;
            uint256 code = uint8(meta);
            uint256 tau = uint32(meta >> 8);
            if (code == 24 && entered == 0) entered = tau;
            if (code == 25 && exited == 0) {
                exited = tau;
                require(r.eventArgs[i] == 135000000, "release");
            }
            if (code == 27 && exited != 0 && tau > exited && regained == 0) regained = tau;
        }
        require(entered > 0 && exited == entered + 9000, "nine seconds fatigue");
        require(regained == exited + 5334, "1000 to 1800 at 150");
    }

    function testFoodCapacityAndBerryGateUseGeneratedRoleData() public pure {
        PaidRaceMotion.Horse[5] memory horses;
        PaidProfiles.Profile[5] memory profiles;
        uint256[5] memory words;
        words[0] = PonyRules.packed(7);
        words[1] = PonyRules.packed(2);
        for (uint256 i; i < 5; ++i) {
            profiles[i] = PaidProfiles.Profile(300, 150, 1800);
        }
        PaidRaceMotion.initHorses(horses, profiles, words, 600001, 0);
        require(horses[0].s == 400000000 && horses[0].staminaCapacity == 400000000, "food capacity");
        horses[1].equipTorso = 1;
        horses[1].equipTail = 2;
        int256[5] memory previous;
        PaidRaceMotion.syncPonyPassives(horses, words, previous);
        require(horses[1].aggP == 1000, "one Berry gate");
        horses[1].equipTorso = 0;
        horses[1].equipTail = 0;
        PaidRaceMotion.syncPonyPassives(horses, words, previous);
        require(horses[1].aggP == 0, "Berry gate removed");
    }
}
