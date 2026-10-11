// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidRaceMotion} from "../../contracts/libraries/PaidRaceMotion.sol";
import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";

contract PlayerBalanceTest {
    function testExhaustionEntryClampsBaseAndReleaseSchedulesAcceleration() public pure {
        PaidRaceEngine.CoreInput memory input;
        input.playerHorseId = 0;
        input.profiles = PaidProfiles.derive(bytes32(0), bytes32(0), 1, 0);
        input.ponyAbilities = true;
        input.roster = [uint8(0), 2, 3, 4, 5];
        input.playerDeck = [uint8(17), 18, 21, 14, 19, 15, 20, 1, 2, 6, 7, 8, 10, 12];
        for (uint256 h; h < 5; ++h) {
            input.cpuDecks[h] = [uint8(19), 20, 5];
        }
        PaidRaceEngine.Result memory r = PaidRaceEngine.solve(input, PaidRaceEngine.Options(0, false, 0, true));
        bool entered;
        bool exited;
        bool regained;
        for (uint256 i; i < r.eventCount; ++i) {
            uint256 meta = r.eventMeta[i];
            if (uint8(meta >> 40) != 0) continue;
            uint256 code = uint8(meta);
            uint256 tau = uint32(meta >> 8);
            if (code == PaidRaceEngine.EV_EXHAUST_ENTER && tau == 30000) entered = true;
            if (code == PaidRaceEngine.EV_EXHAUST_EXIT && tau == 39000) {
                require(r.eventArgs[i] == 135_000_000, "release stamina");
                exited = true;
            }
            if (code == PaidRaceEngine.EV_BASE_CAP && tau == 43000) {
                require(r.eventArgs[i] == 1_800_000, "regained full base speed");
                regained = true;
            }
        }
        require(entered && exited && regained, "exhaustion lifecycle");
    }

    function testDeathImmediatelyAcceleratesAndLoses10800Distance() public pure {
        PaidRaceEngine.State memory st;
        PaidProfiles.Profile[5] memory profiles = PaidProfiles.derive(bytes32(0), bytes32(0), 1, 0);
        PaidRaceMotion.initHorses(st.horses, profiles, st.ponyWords, 600001, 0);
        // CPUs share the player's start and acceleration; finish them so only the player's dues are scheduled.
        for (uint256 i = 1; i < 5; ++i) {
            st.horses[i].finished = true;
        }
        PaidRaceMotion.Horse memory h = st.horses[0];
        h.b = h.capMilli;
        h.atCap = true;
        PaidRaceEngine._kill(st, 0, 0);
        require(h.b == 0 && h.fixedK == 0 && !h.atCap, "death clears speed");
        require(h.s == 300_000_000 && h.aggRespawn == 1, "death preserves stamina and grants immunity");
        uint256 next = PaidRaceMotion.refresh(st.horses, st.stretch, st.laneLive, st.bombs, 0);
        require(next == 12000 && h.aEff == 150, "immediate 12-second acceleration");
        PaidRaceMotion.advance(st.stretch, 0, 12000);
        require(h.b == 1_800_000, "back to full speed");
        require(h.pos == 10_800_000_000, "death recovery travels 10800");
        require(1_800_000 * 12000 - h.pos == 10_800_000_000, "full-speed distance gap");
        require(h.s == 180_000_000, "12 seconds consumes 120 net stamina");
    }

    function testPlayerStaminaThresholdsAndOpponentRates() public pure {
        PaidRaceMotion.Horse[5] memory horses;
        PaidProfiles.Profile[5] memory profiles = PaidProfiles.derive(bytes32(0), bytes32(0), 1, 3);
        uint256[5] memory words;
        PaidRaceMotion.initHorses(horses, profiles, words, 600001, 3);
        PaidRaceMotion.Horse memory h = horses[3];
        require(h.s == 300_000_000 && h.staminaCapacity == 300_000_000, "player capacity");
        for (uint256 i; i < 5; ++i) {
            if (i == 3) continue;
            require(horses[i].s == 300_000_000 && horses[i].staminaCapacity == 300_000_000, "opponent capacity");
            require(
                horses[i].baseCost == 20_000 && horses[i].baseRegen == 10_000 && horses[i].exhaustRegen == 15_000
                    && horses[i].exhaustRelease == 135_000_000 && horses[i].overcapCostDivisor == 2,
                "opponents share the player stamina model"
            );
            horses[i].finished = true;
        }
        h.b = 1_200_000;
        h.atCap = false;
        h.s = 0;
        h.exhausted = true;
        PaidRaceMotion.Stretch memory sx;
        uint256[5] memory laneLive;
        PaidRaceMotion.Bomb[20] memory bombs;
        require(PaidRaceMotion.refresh(horses, sx, laneLive, bombs, 0) == 9000, "135 / 15 exhaustion duration");
        PaidRaceMotion.advance(sx, 0, 9000);
        require(h.s == 135_000_000, "release stamina");
        require(h.pos == 10_800_000_000, "exhaustion travels 10800");
        (uint256 due,,) = PaidRaceMotion.horseDues(horses);
        require(due == 7, "player exit threshold due");
        h.exhausted = false;
        h.s = 320_000_000;
        h.overcap = true;
        require(PaidRaceMotion.refresh(horses, sx, laneLive, bombs, 9000) == 11000, "half cost overcap boundary");
        PaidRaceMotion.advance(sx, 9000, 11000);
        require(h.s == 300_000_000, "overcap costs 10 per second without regeneration");
    }

}
