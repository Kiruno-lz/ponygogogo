// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "../../contracts/libraries/PaidCardRules.sol";
import {PaidRaceCardPlan} from "../../contracts/libraries/PaidRaceCardPlan.sol";
import {PaidRaceMotion} from "../../contracts/libraries/PaidRaceMotion.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";
import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";

contract PaidRaceNewCardsTest {
    event log_named_uint(string key, uint256 value);

    function testStaminaPaymentBoundariesUseRealCardPlan() public pure {
        uint256[4] memory stamina = [uint256(0), 150_000_000, 300_000_000, 1_000_000_000];
        uint256[4] memory paid = [uint256(0), 150_000_000, 300_000_000, 300_000_000];
        uint256[4] memory bps = [uint256(0), 1750, 3500, 3500];
        uint256[5] memory horses;
        uint256[3] memory equipment;
        for (uint256 i; i < 4; ++i) {
            horses[1] = stamina[i] << 128;
            (uint256[] memory actions,) = PaidRaceCardPlan.plan(22, 1, horses, equipment);
            require(uint64(actions[0] >> 48) == paid[i] && uint64(actions[1] >> 48) == bps[i], "payment boundary");
        }
    }

    function testPlanFiltersFinishedAndImmuneTargetsBeforeTieBreak() public pure {
        uint256[5] memory horses;
        uint256[3] memory equipment;
        horses[0] = 200 | (uint256(1) << 192); // already finished
        horses[1] = 100;
        horses[2] = 150 | (uint256(1) << 193); // nearest, but blinded
        horses[3] = 200;
        horses[4] = 200;
        (uint256[] memory actions,) = PaidRaceCardPlan.plan(34, 1, horses, equipment);
        require(uint64(actions[1] >> 48) == 3, "eligible tie target");
        (actions,) = PaidRaceCardPlan.plan(36, 1, horses, equipment);
        require(actions.length == 5 && uint8(actions[0] >> 8) == 1, "finished horse excluded from feast");
    }

    function testPercentageAndFixedPoolsGive44UnitsPerSecond() public pure {
        PaidRaceMotion.Horse memory horse;
        horse.b = 20_000;
        horse.capMilli = 20_000;
        horse.pStatic = 7000;
        horse.fixedMilli = 10_000;
        horse.s = 1_000_000_000;
        horse.crossPos = type(uint256).max;
        horse.cpDist = type(uint256).max;
        PaidRaceMotion.Stretch memory sx;
        sx.runCount = 1;
        assembly ("memory-safe") { mstore(add(sx, 0x20), horse) }
        PaidRaceMotion.advance(sx, 0, 1000);
        require(horse.pos == 44_000_000, "percent/fixed pools differ from TS v=44 vector");
    }

    function testEquipmentTieAndRefreshAllThreeSlotsUseSnapshotPlan() public pure {
        uint256[5] memory horses;
        uint256[3] memory equipment;
        equipment[0] = 5 | (uint256(7) << 8) | (uint256(10000) << 16);
        equipment[1] = 2 | (uint256(8) << 8) | (uint256(10000) << 16);
        equipment[2] = 8 | (uint256(11) << 8) | (uint256(10000) << 16);
        (uint256[] memory actions,) = PaidRaceCardPlan.plan(30, 0, horses, equipment);
        require(
            uint8(actions[0]) == PaidRaceCardPlan.RECYCLE && uint64(actions[0] >> 48) == 2, "recycling tie instance id"
        );
        (actions,) = PaidRaceCardPlan.plan(32, 0, horses, equipment);
        require(actions.length == 3, "refresh must not create fallback buff with equipment");
        for (uint256 i; i < 3; ++i) {
            require(
                uint8(actions[i]) == PaidRaceCardPlan.RENEW && uint64(actions[i] >> 48) == uint8(equipment[i]),
                "all equipment slots"
            );
        }
    }

    function testSignedMotionClipsBeforeCrossingZero() public pure {
        PaidRaceMotion.Horse memory horse;
        horse.aEff = 1;
        horse.accel = 1;
        horse.capMilli = 100_000;
        horse.fixedMilli = -20_000;
        horse.s = 1_000_000_000;
        horse.crossPos = type(uint256).max;
        horse.cpDist = type(uint256).max;
        PaidRaceMotion.Stretch memory sx;
        sx.runCount = 1;
        assembly ("memory-safe") { mstore(add(sx, 0x20), horse) }
        PaidRaceMotion.advance(sx, 0, 10_000);
        require(horse.pos == 0 && horse.dist == 0, "negative motion");
        PaidRaceMotion.advance(sx, 10_000, 30_000);
        require(horse.pos == 50_000_000, "zero crossing integral");
    }

    function _lifecycleState() private returns (PaidRaceEngine.State memory st) {
        st.logEvents = true;
        st.eventMeta = new uint256[](4096);
        st.eventArgs = new int256[](4096);
        st.horses[0].b = 1_200_000;
        st.horses[0].s = 1_000_000_000;
        st.instMin = PaidRaceEngine.NEVER;
        for (uint256 i; i < 96; ++i) {
            st.instNext[i] = PaidRaceEngine.NEVER;
        }
    }

    function testRespawnImmunityDoesNotConsumeWaitingGuard() public {
        PaidRaceEngine.State memory st = _lifecycleState();
        st.instanceCount = 2;
        st.instances[0].active = true;
        st.instances[0].kind = PaidRaceEngine.KIND_WATCH;
        st.instances[0].cardId = 37;
        st.instances[0].end = PaidRaceEngine.NEVER;
        st.instances[0].slot = PaidRaceEngine.NO_SLOT;
        st.instances[1].active = true;
        st.instances[1].kind = PaidRaceEngine.KIND_RESPAWN;
        st.instances[1].end = 4000;
        st.instances[1].slot = PaidRaceEngine.NO_SLOT;
        st.horses[0].aggRespawn = 1;
        PaidRaceEngine._kill(st, 0, 1000);
        require(
            st.instances[0].active && st.instanceCount == 2 && st.horses[0].b == 1_200_000, "immunity consumed guard"
        );
        require(st.eventMeta[0] & 0xff == PaidRaceEngine.EV_DEATH_IMMUNE, "immunity event");
        PaidRaceEngine._expire(st, 1, 4000);
        PaidRaceEngine._kill(st, 0, 5000);
        require(
            !st.instances[0].active && st.horses[0].b == 1_200_000 && st.horses[0].aggRespawn == 0,
            "guard did not replace death"
        );
    }

    function _burstState() private returns (PaidRaceEngine.State memory st) {
        st = _lifecycleState();
        st.instanceCount = 1;
        st.instances[0].active = true;
        st.instances[0].kind = PaidRaceEngine.KIND_WATCH;
        st.instances[0].cardId = 38;
        st.instances[0].end = 50_000;
        st.instances[0].slot = PaidRaceEngine.NO_SLOT;
        PaidRaceEngine._kill(st, 0, 1000);
        require(st.horses[0].fixedK == 120 && !st.instances[0].active, "first death burst");
        PaidRaceEngine._expire(st, 1, 6000);
    }

    function testSecondDeathClearsFixedBurstWithoutLaterDoubleSubtraction() public {
        PaidRaceEngine.State memory st = _burstState();
        PaidRaceEngine._kill(st, 0, 7000);
        require(
            st.horses[0].fixedK == 0 && !st.instances[2].active && st.instances[2].fixedDelta == 0,
            "second death retained burst"
        );
        require(st.instNext[2] == PaidRaceEngine.NEVER, "expired contribution remained scheduled");
        // The original deadline is not scheduled anymore, so the solver will never expire this contribution twice.
    }

    function testFixedDeadlineAndDeathAtSameInstantKeepSignedPoolAtZero() public {
        PaidRaceEngine.State memory st = _burstState();
        st.horses[0].fixedK += 10; // an independent historical wheel burst
        PaidRaceEngine._expire(st, 2, 31_000);
        require(st.horses[0].fixedK == 10, "expiry removed unrelated fixed speed");
        PaidRaceEngine._kill(st, 0, 31_000);
        require(st.horses[0].fixedK == 0 && st.instances[2].fixedDelta == 0, "same-instant death double subtraction");
    }

    function testMileageCardRunsInSolidity() public {
        PaidRaceEngine.CoreInput memory input;
        input.playerHorseId = 1;
        input.playerDeck = [uint8(40), 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
        for (uint256 h; h < 5; ++h) {
            input.profiles[h] = PaidProfiles.Profile(1000, 0, 1000);
            input.cpuDecks[h] = [uint8(19), 20, 5];
        }
        input.choices[0] = IPaidRaceSolver.ChoiceInput(true, 25, 40, new uint8[](0), bytes32(uint256(1)));
        PaidRaceEngine.Options memory opts;
        opts.logEvents = true;
        PaidRaceEngine.Result memory result = PaidRaceEngine.solve(input, opts);
        uint256 growth;
        bool debt;
        for (uint256 i; i < result.eventCount; ++i) {
            uint256 code = result.eventMeta[i] & 0xff;
            uint256 horse = (result.eventMeta[i] >> 40) & 0xff;
            if (horse != 1) continue;
            if (code == 34 && result.eventArgs[i] == -20) debt = true;
            if (code == 29 && uint256(result.eventArgs[i]) / 256 == 40) ++growth;
        }
        emit log_named_uint("debt", debt ? 1 : 0);
        emit log_named_uint("growth", growth);
        require(debt && growth == 3, "mileage debt and three growth events");
    }
}
