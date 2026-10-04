// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "./PaidCardRules.sol";

/// @notice Hot path of the paid-race solver (有奖规则 v2 「运动区间」「重力井数值积分」): the per-horse motion state, the
/// caches that only change at events, and the loop that advances all running horses from one event to the next.
/// @dev The solver spends almost all of its gas between events, so this library works directly on the memory layout
/// of `Horse` in inline assembly. Every `Horse` member is one 32-byte word; the `H_*` offsets below must list the
/// members in declaration order (tests/contracts/PaidRaceMotion.t.sol pins them).
///
/// Exactness argument for `advance`: between two events nothing the reference solver reads can change except
/// positions, base speeds and stamina. Its per-boundary `nextKnownTau` is then the same absolute time at every
/// boundary (base-speed and stamina thresholds move linearly; instance, trigger and panel times are absolute), and
/// no due can appear before that time except through a crossing, which truncates the step. So one call runs the
/// reference's boundary loop until the horizon or the first crossing, and stamina (piecewise linear with monotone
/// clamps) is folded once at the end instead of per step.
///
/// Overflow: profiles are uint32 with cap <= 1e6 (b <= 1e9 mu/s), a stretch is <= 600000 ms, positions stay near
/// 1e11 µu and percentage sums are bounded by 96 instances of int32 table values plus five wells, so every product
/// below stays far under 2^255; unchecked Yul arithmetic cannot wrap.
library PaidRaceMotion {
    error NoProgress();
    error StaminaInvariant();

    uint256 internal constant TRACK_MICRO = 100_000_000_000;
    uint256 internal constant CHECKPOINT_MICRO = 25_000_000_000;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MIN_COST = PaidCardRules.MIN_COST_FACTOR_BPS;
    uint256 internal constant HORSE_WORDS = 40;
    uint256 internal constant STAMINA_CAPACITY = 1_000_000_000;
    uint256 internal constant COST_PER_MS = 24_000;
    uint256 internal constant REGEN_PER_MS = 10_000;
    /// @dev Exhaustion penalty E = 10 units/s, in mu/s.
    uint256 internal constant EXHAUST_PENALTY_MILLI = 10_000;
    uint256 internal constant RK_STEP_MS = PaidCardRules.RK_STEP_MS;
    uint256 internal constant NEVER = 0xffffffff;

    /// @dev One word per member; see the H_* offsets.
    struct Horse {
        uint256 pos;
        uint256 dist;
        uint256 prevPos;
        uint256 b;
        uint256 s;
        uint256 capMilli;
        uint256 accel;
        int256 fixedK;
        uint256 lane;
        uint256 cp;
        bool exhausted;
        bool overcap;
        bool atCap;
        bool finished;
        bool blindedPro;
        bool drawCut;
        bool bonus;
        uint256 finishTime;
        uint256 finishWall;
        uint256 equipTorso;
        uint256 equipTail;
        uint256 equipHooves;
        // Totals over the horse's active effect instances (the reference's `mods` loop, kept incrementally).
        int256 aggP;
        uint256 aggRegen;
        uint256 aggAirborne;
        uint256 aggWired;
        uint256 aggRespawn;
        // Caches written by `refresh`, valid until the next event.
        int256 pStatic;
        uint256 aEff;
        int256 fixedMilli;
        uint256 crossPos;
        uint256 cpDist;
        uint256 cost;
        uint256 regen;
        // Step scratch.
        uint256 mult;
        uint256 mid;
        int256 field;
        uint256 delta;
        int256 aggCost;
        uint256 nextDist;
    }

    uint256 internal constant H_POS = 0x000;
    uint256 internal constant H_DIST = 0x020;
    uint256 internal constant H_PREV = 0x040;
    uint256 internal constant H_B = 0x060;
    uint256 internal constant H_S = 0x080;
    uint256 internal constant H_CAP = 0x0a0;
    uint256 internal constant H_ACCEL = 0x0c0;
    uint256 internal constant H_FIXED = 0x0e0;
    uint256 internal constant H_LANE = 0x100;
    uint256 internal constant H_CP = 0x120;
    uint256 internal constant H_EXHAUSTED = 0x140;
    uint256 internal constant H_OVERCAP = 0x160;
    uint256 internal constant H_AT_CAP = 0x180;
    uint256 internal constant H_FINISHED = 0x1a0;
    uint256 internal constant H_BLINDED = 0x1c0;
    uint256 internal constant H_EQUIP = 0x260;
    uint256 internal constant H_AGG_P = 0x2c0;
    uint256 internal constant H_AGG_REGEN = 0x2e0;
    uint256 internal constant H_AGG_AIR = 0x300;
    uint256 internal constant H_AGG_WIRED = 0x320;
    uint256 internal constant H_P_STATIC = 0x360;
    uint256 internal constant H_A_EFF = 0x380;
    uint256 internal constant H_FIXED_MILLI = 0x3a0;
    uint256 internal constant H_CROSS_POS = 0x3c0;
    uint256 internal constant H_CP_DIST = 0x3e0;
    uint256 internal constant H_COST = 0x400;
    uint256 internal constant H_REGEN = 0x420;
    uint256 internal constant H_MULT = 0x440;
    uint256 internal constant H_MID = 0x460;
    uint256 internal constant H_FIELD = 0x480;
    uint256 internal constant H_DELTA = 0x4a0;
    uint256 internal constant H_AGG_COST = 0x4c0;
    uint256 internal constant H_NEXT_DIST = 0x4e0;

    struct Bomb {
        uint256 pos;
        uint256 lane;
        uint256 placer;
        bool live;
    }

    uint256 internal constant B_POS = 0x00;
    uint256 internal constant B_PLACER = 0x40;

    /// @dev Horses in play between two events; word layout fixed like `Horse` (S_* offsets).
    struct Stretch {
        uint256 runCount;
        uint256 run0;
        uint256 run1;
        uint256 run2;
        uint256 run3;
        uint256 run4;
        uint256 ownerCount;
        uint256 own0;
        uint256 own1;
        uint256 own2;
        uint256 own3;
        uint256 own4;
        uint256 radius;
        uint256 strength;
        int256 overlap;
        uint256 steps;
        // Event-invariant environment for `refresh`.
        int256 wind;
        uint256 windPlacer;
    }

    uint256 internal constant S_RUN_COUNT = 0x000;
    uint256 internal constant S_RUN = 0x020;
    uint256 internal constant S_OWNER_COUNT = 0x0c0;
    uint256 internal constant S_OWN = 0x0e0;
    uint256 internal constant S_RADIUS = 0x180;
    uint256 internal constant S_STRENGTH = 0x1a0;
    uint256 internal constant S_OVERLAP = 0x1c0;
    uint256 internal constant S_STEPS = 0x1e0;
    uint256 internal constant S_WIND = 0x200;
    uint256 internal constant S_WIND_PLACER = 0x220;
    uint256 internal constant NONE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    uint256 internal constant MAX_OWNERS = 5;

    // ------------------------------------------------------------ small accessors

    function equipOf(Horse memory horse, uint256 slot) internal pure returns (uint256 id) {
        assembly ("memory-safe") {
            id := mload(add(horse, add(H_EQUIP, shl(5, slot))))
        }
    }

    function setEquip(Horse memory horse, uint256 slot, uint256 id) internal pure {
        assembly ("memory-safe") {
            mstore(add(horse, add(H_EQUIP, shl(5, slot))), id)
        }
    }

    function setOwner(Stretch memory sx, uint256 index, Horse memory horse) internal pure {
        assembly ("memory-safe") {
            mstore(add(sx, add(S_OWN, shl(5, index))), horse)
        }
    }

    // ------------------------------------------------------------ dues and caches

    /// @notice findDue's horse classes in one pass: the first horse (by id) with a base-speed cap or stamina
    /// threshold due (class 1, key horse·2 + sub), at the finish (class 2) or past its next checkpoint (class 5);
    /// NONE where no horse is due. Stamina rates come from the instance totals, like the reference's `mods`.
    function horseDues(Horse[5] memory horses) internal pure returns (uint256 cls1, uint256 cls2, uint256 cls5) {
        uint256 minCost = MIN_COST;
        assembly ("memory-safe") {
            cls1 := NONE
            cls2 := NONE
            cls5 := NONE
            for { let i := 0 } lt(i, 5) { i := add(i, 1) } {
                let h := mload(add(horses, shl(5, i)))
                if iszero(mload(add(h, H_FINISHED))) {
                    if eq(cls1, NONE) {
                        // baseDue: !atCap && b >= capMilli
                        switch and(
                            iszero(mload(add(h, H_AT_CAP))),
                            iszero(lt(mload(add(h, H_B)), mload(add(h, H_CAP))))
                        )
                        case 1 { cls1 := shl(1, i) }
                        default {
                            // staminaEventDt(...) == 0
                            let s := mload(add(h, H_S))
                            let due := 0
                            switch mload(add(h, H_EXHAUSTED))
                            case 1 { due := iszero(lt(s, STAMINA_CAPACITY)) }
                            default {
                                switch mload(add(h, H_OVERCAP))
                                case 1 { due := iszero(gt(s, STAMINA_CAPACITY)) }
                                default {
                                    let factor := add(BPS, mload(add(h, H_AGG_COST)))
                                    if slt(factor, minCost) { factor := minCost }
                                    let cost := div(mul(COST_PER_MS, factor), BPS)
                                    let regen := div(mul(REGEN_PER_MS, add(BPS, mload(add(h, H_AGG_REGEN)))), BPS)
                                    due := and(and(lt(regen, cost), iszero(mload(add(h, H_AGG_WIRED)))), iszero(s))
                                }
                            }
                            if due { cls1 := add(shl(1, i), 1) }
                        }
                    }
                    if and(eq(cls2, NONE), iszero(lt(mload(add(h, H_POS)), TRACK_MICRO))) { cls2 := i }
                    let cp := mload(add(h, H_CP))
                    if and(eq(cls5, NONE), lt(cp, 3)) {
                        if iszero(lt(mload(add(h, H_DIST)), mul(add(cp, 1), CHECKPOINT_MICRO))) { cls5 := i }
                    }
                }
            }
        }
    }

    /// @notice Writes the event-invariant caches of every running horse, lists them in `sx`, and returns the
    /// earliest base-speed or stamina threshold time (NEVER when none): the horse part of `nextKnownTau`. Reads the
    /// wind and rocket cost from `sx`; `laneLive[lane]` has bit i set while bomb i is live in that lane.
    function refresh(
        Horse[5] memory horses,
        Stretch memory sx,
        uint256[5] memory laneLive,
        Bomb[20] memory bombs,
        uint256 tau
    ) internal pure returns (uint256 next) {
        uint256 minCost = MIN_COST;
        bytes4 invariant = StaminaInvariant.selector;
        assembly ("memory-safe") {
            function ceilDiv(a, b) -> c {
                c := div(add(a, sub(b, 1)), b)
            }
            // min(TRACK, nearest live bomb ahead in the lane that can hit this horse): crossingNeed's bomb part.
            function bombAhead(h, id, mask, bombs_) -> crossPos {
                crossPos := TRACK_MICRO
                if iszero(mload(add(h, H_AGG_AIR))) {
                    let pos := mload(add(h, H_POS))
                    let blinded := mload(add(h, H_BLINDED))
                    for { let b := 0 } mask { b := add(b, 1) } {
                        if and(mask, 1) {
                            let bomb := mload(add(bombs_, shl(5, b)))
                            let bpos := mload(add(bomb, B_POS))
                            if and(gt(bpos, pos), lt(bpos, crossPos)) {
                                if or(iszero(blinded), eq(mload(add(bomb, B_PLACER)), id)) { crossPos := bpos }
                            }
                        }
                        mask := shr(1, mask)
                    }
                }
            }
            // Base-speed cap time and staminaEventDt, from `now`.
            function threshold(h, cost, regen, now_) -> at {
                let exhausted := mload(add(h, H_EXHAUSTED))
                let b := mload(add(h, H_B))
                let cap := mload(add(h, H_CAP))
                let accel := mload(add(h, H_ACCEL))
                at := NEVER
                if and(iszero(mload(add(h, H_AT_CAP))), and(iszero(exhausted), and(gt(accel, 0), lt(b, cap)))) {
                    at := add(now_, ceilDiv(sub(cap, b), accel))
                }
                let s := mload(add(h, H_S))
                let dt := not(0)
                switch exhausted
                case 1 {
                    dt := 0
                    if lt(s, STAMINA_CAPACITY) { dt := ceilDiv(sub(STAMINA_CAPACITY, s), regen) }
                }
                default {
                    switch mload(add(h, H_OVERCAP))
                    case 1 {
                        dt := 0
                        if gt(s, STAMINA_CAPACITY) { dt := ceilDiv(sub(s, STAMINA_CAPACITY), cost) }
                    }
                    default {
                        if and(lt(regen, cost), iszero(mload(add(h, H_AGG_WIRED)))) {
                            dt := ceilDiv(s, sub(cost, regen))
                        }
                    }
                }
                if iszero(eq(dt, not(0))) { if lt(add(now_, dt), at) { at := add(now_, dt) } }
            }
            // P: instance totals plus a wind that applies to airborne horses, unless blinded by another placer.
            function staticP(h, id, s_) -> p {
                p := mload(add(h, H_AGG_P))
                let wind := mload(add(s_, S_WIND))
                if and(iszero(iszero(wind)), iszero(iszero(mload(add(h, H_AGG_AIR))))) {
                    if or(iszero(mload(add(h, H_BLINDED))), eq(mload(add(s_, S_WIND_PLACER)), id)) {
                        p := add(p, wind)
                    }
                }
            }
            next := NEVER
            let n := 0
            for { let i := 0 } lt(i, 5) { i := add(i, 1) } {
                let h := mload(add(horses, shl(5, i)))
                if iszero(mload(add(h, H_FINISHED))) {
                    // Normal mode never holds more than the capacity (adrenaline sets overcap outside exhaustion,
                    // and an exhausted horse at capacity exits in the same ms): the lazy stamina fold relies on it.
                    if and(
                        iszero(or(mload(add(h, H_EXHAUSTED)), mload(add(h, H_OVERCAP)))),
                        gt(mload(add(h, H_S)), STAMINA_CAPACITY)
                    ) {
                        mstore(0, invariant)
                        revert(0, 4)
                    }
                    mstore(
                        add(h, H_CROSS_POS),
                        bombAhead(h, i, mload(add(laneLive, shl(5, mload(add(h, H_LANE))))), bombs)
                    )
                    let cost := 0
                    {
                        let factor := add(BPS, mload(add(h, H_AGG_COST)))
                        if slt(factor, minCost) { factor := minCost }
                        cost := div(mul(COST_PER_MS, factor), BPS)
                    }
                    let regen := div(mul(REGEN_PER_MS, add(BPS, mload(add(h, H_AGG_REGEN)))), BPS)
                    mstore(add(h, H_COST), cost)
                    mstore(add(h, H_REGEN), regen)
                    mstore(add(h, H_P_STATIC), staticP(h, i, sx))
                    let aEff := 0
                    if and(iszero(mload(add(h, H_EXHAUSTED))), lt(mload(add(h, H_B)), mload(add(h, H_CAP)))) {
                        aEff := mload(add(h, H_ACCEL))
                    }
                    mstore(add(h, H_A_EFF), aEff)
                    mstore(add(h, H_FIXED_MILLI), mul(mload(add(h, H_FIXED)), 1000))
                    {
                        let cp := mload(add(h, H_CP))
                        let cpDist := not(0)
                        if lt(cp, 3) { cpDist := mul(add(cp, 1), CHECKPOINT_MICRO) }
                        let nd := mload(add(h, H_NEXT_DIST))
                        if and(iszero(iszero(nd)), lt(nd, cpDist)) { cpDist := nd }
                        mstore(add(h, H_CP_DIST), cpDist)
                    }
                    let at := threshold(h, cost, regen, tau)
                    if lt(at, next) { next := at }
                    mstore(add(sx, add(S_RUN, shl(5, n))), h)
                    n := add(n, 1)
                }
            }
            mstore(add(sx, S_RUN_COUNT), n)
        }
    }

    // ------------------------------------------------------------ advance

    /// @notice Advances every running horse from `tau` until `horizon` or the first millisecond some horse reaches
    /// its finish, checkpoint or bomb, taking RK2 steps of at most RK_STEP_MS while a well is active.
    /// @return t the new time
    /// @return cut true when the last step was truncated at a crossing
    function advance(Stretch memory sx, uint256 tau, uint256 horizon) internal pure returns (uint256 t, bool cut) {
        if (horizon <= tau) revert NoProgress();
        uint256 rkStep = RK_STEP_MS;
        assembly ("memory-safe") {
            // Δpos over dt ms at multiplier mu: analytic while not exhausted, constant speed while exhausted.
            function delta(h, mu, dt) -> d {
                let b := mload(add(h, H_B))
                let fixed_ := mload(add(h, H_FIXED_MILLI))
                switch mload(add(h, H_EXHAUSTED))
                case 0 {
                    let initial := add(mul(b, mu), mul(fixed_, BPS))
                    if slt(initial, 0) {
                        let slope := mul(mload(add(h, H_A_EFF)), mu)
                        if iszero(slope) { leave }
                        let zero := div(add(sub(0, initial), sub(slope, 1)), slope)
                        if iszero(gt(dt, zero)) { leave }
                        dt := sub(dt, zero)
                        b := add(b, mul(mload(add(h, H_A_EFF)), zero))
                    }
                    d := add(
                        div(mul(mu, add(mul(shl(1, b), dt), mul(mload(add(h, H_A_EFF)), mul(dt, dt)))), 20000),
                        mul(fixed_, dt)
                    )
                    if slt(d, 0) { d := 0 }
                }
                default {
                    let v := add(div(mul(b, mu), BPS), mload(add(h, H_FIXED_MILLI)))
                    if sgt(v, EXHAUST_PENALTY_MILLI) { d := mul(sub(v, EXHAUST_PENALTY_MILLI), dt) }
                }
            }
            // Smallest dt in [1, hi] with delta >= n (firstReach); delta is non-decreasing in dt.
            function reach(h, mu, n, hi) -> lo {
                lo := 1
                for {} lt(lo, hi) {} {
                    let md := shr(1, add(lo, hi))
                    switch lt(delta(h, mu, md), n)
                    case 0 { hi := md }
                    default { lo := add(md, 1) }
                }
            }
            function multiplier(h) -> mu {
                mu := add(BPS, add(mload(add(h, H_P_STATIC)), mload(add(h, H_FIELD))))
                if slt(mu, 0) { mu := 0 }
                mstore(add(h, H_FIELD), 0)
            }
            // Adds each well's field (wellFieldBps) to every other running horse, positions read at `slot`.
            function accumulate(s, slot) {
                let rend := add(add(s, S_RUN), shl(5, mload(add(s, S_RUN_COUNT))))
                let own := add(s, S_OWN)
                let oend := add(own, shl(5, mload(add(s, S_OWNER_COUNT))))
                let r := mload(add(s, S_RADIUS))
                for {} lt(own, oend) { own := add(own, 0x20) } {
                    let ho := mload(own)
                    let op := mload(add(ho, slot))
                    for { let p := add(s, S_RUN) } lt(p, rend) { p := add(p, 0x20) } {
                        let ht := mload(p)
                        if iszero(eq(ho, ht)) {
                            let tp := mload(add(ht, slot))
                            switch gt(tp, op)
                            case 1 {
                                // Target ahead of the well: slowed.
                                let d := sub(tp, op)
                                if lt(d, r) {
                                    let k := div(mul(mload(add(s, S_STRENGTH)), sub(BPS, div(mul(d, BPS), r))), BPS)
                                    mstore(add(ht, H_FIELD), sub(mload(add(ht, H_FIELD)), k))
                                }
                            }
                            default {
                                // Target behind (or level with, the overlap branch): pulled forward.
                                let d := sub(op, tp)
                                if lt(d, r) {
                                    let k := mload(add(s, S_OVERLAP))
                                    if d {
                                        k := div(mul(mload(add(s, S_STRENGTH)), sub(BPS, div(mul(d, BPS), r))), BPS)
                                    }
                                    mstore(add(ht, H_FIELD), add(mload(add(ht, H_FIELD)), k))
                                }
                            }
                        }
                    }
                }
            }
            // RK2 midpoint: advance floor(limit/2) at P_static + P0 from the step-start positions.
            function midpoint(s, limit) {
                let half := shr(1, limit)
                let rend := add(add(s, S_RUN), shl(5, mload(add(s, S_RUN_COUNT))))
                for { let p := add(s, S_RUN) } lt(p, rend) { p := add(p, 0x20) } {
                    let h := mload(p)
                    mstore(add(h, H_MID), add(mload(add(h, H_POS)), delta(h, multiplier(h), half)))
                }
            }
            // Frozen multiplier per horse; dt shrinks to the first crossing (crossingNeed / firstReach).
            function plan(s, limit) -> dt, c {
                dt := limit
                let rend := add(add(s, S_RUN), shl(5, mload(add(s, S_RUN_COUNT))))
                for { let p := add(s, S_RUN) } lt(p, rend) { p := add(p, 0x20) } {
                    let h := mload(p)
                    let mu := multiplier(h)
                    mstore(add(h, H_MULT), mu)
                    let n := sub(mload(add(h, H_CROSS_POS)), mload(add(h, H_POS)))
                    let n2 := sub(mload(add(h, H_CP_DIST)), mload(add(h, H_DIST)))
                    if lt(n2, n) { n := n2 }
                    let d := delta(h, mu, dt)
                    mstore(add(h, H_DELTA), d)
                    if iszero(lt(d, n)) {
                        dt := reach(h, mu, n, dt)
                        c := 1
                    }
                }
            }
            function apply(s, dt, c) {
                let rend := add(add(s, S_RUN), shl(5, mload(add(s, S_RUN_COUNT))))
                for { let p := add(s, S_RUN) } lt(p, rend) { p := add(p, 0x20) } {
                    let h := mload(p)
                    let d := mload(add(h, H_DELTA))
                    if c { d := delta(h, mload(add(h, H_MULT)), dt) }
                    let old := mload(add(h, H_POS))
                    mstore(add(h, H_PREV), old)
                    mstore(add(h, H_POS), add(old, d))
                    mstore(add(h, H_DIST), add(mload(add(h, H_DIST)), d))
                    let a := mload(add(h, H_A_EFF))
                    if a {
                        let b := add(mload(add(h, H_B)), mul(a, dt))
                        let cap := mload(add(h, H_CAP))
                        if gt(b, cap) { b := cap }
                        mstore(add(h, H_B), b)
                    }
                }
            }
            // staminaAfter over the whole stretch; clamps are monotone so this equals the per-step fold.
            function stamina(s, span) {
                let rend := add(add(s, S_RUN), shl(5, mload(add(s, S_RUN_COUNT))))
                for { let p := add(s, S_RUN) } lt(p, rend) { p := add(p, 0x20) } {
                    let h := mload(p)
                    let st := mload(add(h, H_S))
                    let cost := mload(add(h, H_COST))
                    let regen := mload(add(h, H_REGEN))
                    switch mload(add(h, H_EXHAUSTED))
                    case 1 {
                        st := add(st, mul(regen, span))
                        if gt(st, STAMINA_CAPACITY) { st := STAMINA_CAPACITY }
                    }
                    default {
                        switch mload(add(h, H_OVERCAP))
                        case 1 { st := sub(st, mul(cost, span)) }
                        default {
                            switch lt(regen, cost)
                            case 1 {
                                let dec := mul(sub(cost, regen), span)
                                switch gt(dec, st)
                                case 1 { st := 0 }
                                default { st := sub(st, dec) }
                            }
                            default {
                                st := add(st, mul(sub(regen, cost), span))
                                if gt(st, STAMINA_CAPACITY) { st := STAMINA_CAPACITY }
                            }
                        }
                    }
                    mstore(add(h, H_S), st)
                }
            }
            let wells := mload(add(sx, S_OWNER_COUNT))
            t := tau
            for {} 1 {} {
                let limit := sub(horizon, t)
                if wells {
                    if gt(limit, rkStep) { limit := rkStep }
                    mstore(add(sx, S_STEPS), add(mload(add(sx, S_STEPS)), 1))
                    accumulate(sx, H_POS)
                    midpoint(sx, limit)
                    accumulate(sx, H_MID)
                }
                let dt, c := plan(sx, limit)
                apply(sx, dt, c)
                t := add(t, dt)
                if or(c, eq(t, horizon)) {
                    cut := c
                    break
                }
            }
            stamina(sx, sub(t, tau))
        }
    }
}
