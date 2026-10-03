// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidRaceMotion} from "../../contracts/PaidRaceMotion.sol";
import {PaidCardRules} from "../../contracts/PaidCardRules.sol";

/// @notice Synthetic stretches for PaidRaceMotion: five running horses spaced inside the well radius, never crossing.
contract FieldStretchProbe {
    function stretch(uint256 wells, uint256 horizon)
        external
        view
        returns (uint256 gasUsed, uint256 steps, uint256[5] memory pos, uint256[5] memory stamina)
    {
        (PaidRaceMotion.Horse[5] memory horses, PaidRaceMotion.Stretch memory sx) = _setup(wells);
        uint256 before = gasleft();
        PaidRaceMotion.advance(sx, 0, horizon);
        gasUsed = before - gasleft();
        steps = sx.steps;
        for (uint256 h; h < 5; ++h) {
            pos[h] = horses[h].pos;
            stamina[h] = horses[h].s;
        }
    }

    /// @dev The same stretch split at `cut` (two advance calls, stamina folded twice).
    function split(uint256 cut, uint256 horizon)
        external
        pure
        returns (uint256[5] memory pos, uint256[5] memory stamina)
    {
        (PaidRaceMotion.Horse[5] memory horses, PaidRaceMotion.Stretch memory sx) = _setup(0);
        PaidRaceMotion.advance(sx, 0, cut);
        PaidRaceMotion.advance(sx, cut, horizon);
        for (uint256 h; h < 5; ++h) {
            pos[h] = horses[h].pos;
            stamina[h] = horses[h].s;
        }
    }

    function _setup(uint256 wells)
        private
        pure
        returns (PaidRaceMotion.Horse[5] memory horses, PaidRaceMotion.Stretch memory sx)
    {
        PaidCardRules.Rule memory gravity = PaidCardRules.get(10);
        sx.radius = gravity.radiusMicro;
        sx.strength = gravity.strengthBps;
        sx.overlap = gravity.overlapBps;
        for (uint256 h; h < 5; ++h) {
            PaidRaceMotion.Horse memory horse = horses[h];
            horse.pos = h * 1_000_000_000;
            horse.dist = horse.pos;
            horse.b = 1_200_000 + h * 30_000;
            horse.capMilli = 1_800_000;
            horse.accel = 12;
            horse.aEff = 12;
            horse.s = PaidRaceMotion.STAMINA_CAPACITY;
            horse.cost = h == 2 ? 12_000 : 24_000; // one rocket: net stays negative, one horse clamps at 0
            horse.regen = h == 4 ? 30_000 : 10_000; // one horse regenerates above its cost: clamps at capacity
            horse.pStatic = 1_000;
            horse.crossPos = type(uint256).max;
            horse.cpDist = type(uint256).max;
            _set(sx, PaidRaceMotion.S_RUN, h, horse);
            if (h < wells) _set(sx, PaidRaceMotion.S_OWN, h, horse);
        }
        sx.runCount = 5;
        sx.ownerCount = wells;
    }

    function _set(PaidRaceMotion.Stretch memory sx, uint256 base, uint256 index, PaidRaceMotion.Horse memory horse)
        private
        pure
    {
        assembly ("memory-safe") {
            mstore(add(sx, add(base, shl(5, index))), horse)
        }
    }
}

contract PaidRaceMotionTest {
    event log_named_uint(string key, uint256 val);

    /// @dev Fixed benchmark: ten ten-second well lifetimes at H = 50 ms; refresh extends the v4 budget.
    uint256 internal constant CEILING_STEPS = 2_000;
    uint256 internal constant CEILING_MS = 100_000;

    /// @notice The H_*/S_*/B_* offsets the assembly uses are the Solidity member offsets.
    function testLayoutOffsetsMatchStructOrder() public pure {
        PaidRaceMotion.Horse memory h;
        h.pos = 1;
        h.dist = 2;
        h.prevPos = 3;
        h.b = 4;
        h.s = 5;
        h.capMilli = 6;
        h.accel = 7;
        h.fixedK = 8;
        h.lane = 9;
        h.cp = 10;
        h.exhausted = true;
        h.equipTorso = 12;
        h.aggP = 13;
        h.aggRegen = 14;
        h.aggAirborne = 16;
        h.aggWired = 17;
        h.pStatic = 18;
        h.aEff = 19;
        h.fixedMilli = 20;
        h.crossPos = 21;
        h.cpDist = 22;
        h.cost = 23;
        h.regen = 24;
        h.mult = 25;
        h.mid = 26;
        h.field = 27;
        h.delta = 28;
        h.aggCost = -4000;
        h.nextDist = 45000000000;
        require(_word(h, PaidRaceMotion.H_AGG_COST) == uint256(int256(-4000)), "signed cost offset");
        require(_word(h, PaidRaceMotion.H_NEXT_DIST) == 45000000000, "mileage offset");
        require(PaidRaceMotion.HORSE_WORDS * 32 == PaidRaceMotion.H_NEXT_DIST + 32, "raw ABI size");
        uint256[27] memory offsets = [
            PaidRaceMotion.H_POS,
            PaidRaceMotion.H_DIST,
            PaidRaceMotion.H_PREV,
            PaidRaceMotion.H_B,
            PaidRaceMotion.H_S,
            PaidRaceMotion.H_CAP,
            PaidRaceMotion.H_ACCEL,
            PaidRaceMotion.H_FIXED,
            PaidRaceMotion.H_LANE,
            PaidRaceMotion.H_CP,
            PaidRaceMotion.H_EXHAUSTED,
            PaidRaceMotion.H_EQUIP,
            PaidRaceMotion.H_AGG_P,
            PaidRaceMotion.H_AGG_REGEN,
            PaidRaceMotion.H_AGG_AIR,
            PaidRaceMotion.H_AGG_WIRED,
            PaidRaceMotion.H_P_STATIC,
            PaidRaceMotion.H_A_EFF,
            PaidRaceMotion.H_FIXED_MILLI,
            PaidRaceMotion.H_CROSS_POS,
            PaidRaceMotion.H_CP_DIST,
            PaidRaceMotion.H_COST,
            PaidRaceMotion.H_REGEN,
            PaidRaceMotion.H_MULT,
            PaidRaceMotion.H_MID,
            PaidRaceMotion.H_FIELD,
            PaidRaceMotion.H_DELTA
        ];
        uint256[27] memory expected =
            [uint256(1), 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
        for (uint256 i; i < 27; ++i) {
            require(_word(h, offsets[i]) == expected[i], "horse offset");
        }
        PaidRaceMotion.Horse memory flags;
        flags.overcap = true;
        require(_word(flags, PaidRaceMotion.H_OVERCAP) == 1, "overcap offset");
        flags.atCap = true;
        require(_word(flags, PaidRaceMotion.H_AT_CAP) == 1, "atCap offset");
        flags.finished = true;
        require(_word(flags, PaidRaceMotion.H_FINISHED) == 1, "finished offset");
        flags.blindedPro = true;
        require(_word(flags, PaidRaceMotion.H_BLINDED) == 1, "blinded offset");
        require(PaidRaceMotion.equipOf(h, 0) == 12, "equip slot 0");

        PaidRaceMotion.Stretch memory sx;
        sx.runCount = 31;
        sx.ownerCount = 32;
        sx.radius = 33;
        sx.strength = 34;
        sx.overlap = 35;
        sx.steps = 36;
        sx.wind = 37;
        sx.windPlacer = 38;
        require(
            _sword(sx, PaidRaceMotion.S_RUN_COUNT) == 31 && _sword(sx, PaidRaceMotion.S_OWNER_COUNT) == 32, "S counts"
        );
        require(_sword(sx, PaidRaceMotion.S_RADIUS) == 33 && _sword(sx, PaidRaceMotion.S_STRENGTH) == 34, "S well");
        require(_sword(sx, PaidRaceMotion.S_OVERLAP) == 35 && _sword(sx, PaidRaceMotion.S_STEPS) == 36, "S steps");
        require(_sword(sx, PaidRaceMotion.S_WIND) == 37 && _sword(sx, PaidRaceMotion.S_WIND_PLACER) == 38, "S wind");
        sx.run0 = 40;
        sx.own0 = 41;
        require(_sword(sx, PaidRaceMotion.S_RUN) == 40 && _sword(sx, PaidRaceMotion.S_OWN) == 41, "S lists");

        PaidRaceMotion.Bomb memory bomb = PaidRaceMotion.Bomb(51, 52, 53, true);
        uint256 bpos;
        uint256 placer;
        assembly ("memory-safe") {
            bpos := mload(add(bomb, 0x00))
            placer := mload(add(bomb, 0x40))
        }
        require(PaidRaceMotion.B_POS == 0x00 && PaidRaceMotion.B_PLACER == 0x40 && bpos == 51 && placer == 53, "bomb");
    }

    /// @notice Stamina folded once per stretch equals folding it at any intermediate boundary (the clamps are
    /// monotone), which is what lets `advance` skip the reference's per-step staminaAfter.
    function testLazyStaminaFoldEqualsSplitFold() public {
        FieldStretchProbe probe = new FieldStretchProbe();
        uint256[4] memory cuts = [uint256(1), 7_777, 40_000, 99_999];
        (,, uint256[5] memory posOnce, uint256[5] memory once) = probe.stretch(0, CEILING_MS);
        for (uint256 i; i < cuts.length; ++i) {
            (, uint256[5] memory splitStamina) = probe.split(cuts[i], CEILING_MS);
            for (uint256 h; h < 5; ++h) {
                require(splitStamina[h] == once[h], "stamina fold depends on the split");
            }
        }
        require(once[0] == 0 && once[4] == PaidRaceMotion.STAMINA_CAPACITY, "clamps reached");
        require(posOnce[0] > 0, "moved");
    }

    /// @notice Compare a fixed 100-second field-work budget as 2000 one-well steps or 400 five-well steps.
    /// Refresh can extend well lifetimes; this benchmark is not the full v4 worst-case gas proof.
    function testTheoreticalFieldCeilingGas() public {
        FieldStretchProbe probe = new FieldStretchProbe();
        (uint256 one, uint256 steps1,,) = probe.stretch(1, CEILING_MS);
        (uint256 five, uint256 steps5,,) = probe.stretch(5, CEILING_MS / 5);
        require(steps1 == CEILING_STEPS && steps5 == CEILING_STEPS / 5, "step counts");
        emit log_named_uint("field ceiling: 2000 steps, 1 well (gas)", one);
        emit log_named_uint("field ceiling: 400 steps, 5 wells (gas)", five);
        emit log_named_uint("gas per 1-well step", one / steps1);
        emit log_named_uint("gas per 5-well step", five / steps5);
        require(five <= one, "five overlapping wells must not cost more than the sequential budget");
        require(one < 20_000_000, "field ceiling");
    }

    function _word(PaidRaceMotion.Horse memory h, uint256 offset) private pure returns (uint256 v) {
        assembly ("memory-safe") {
            v := mload(add(h, offset))
        }
    }

    function _sword(PaidRaceMotion.Stretch memory sx, uint256 offset) private pure returns (uint256 v) {
        assembly ("memory-safe") {
            v := mload(add(sx, offset))
        }
    }
}
