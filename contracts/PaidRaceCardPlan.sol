// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "./PaidCardRules.sol";

/// @notice Snapshot decisions for C-22..C-40. The engine alone applies actions and owns event ordering/lifecycles.
library PaidRaceCardPlan {
    uint8 internal constant BUFF = 0;
    uint8 internal constant WATCH = 1;
    uint8 internal constant GATE = 2;
    uint8 internal constant PAY = 3;
    uint8 internal constant RECOVER = 4;
    uint8 internal constant RECYCLE = 5;
    uint8 internal constant RENEW = 6;
    uint8 internal constant FIXED = 7;
    uint8 internal constant TARGET = 8;
    uint8 internal constant TINKER = 9;

    struct Horse {
        uint256 pos;
        uint256 dist;
        uint256 stamina;
        bool finished;
        bool blinded;
    }

    struct Equipment {
        uint256 id;
        uint8 cardId;
        uint256 end;
    }

    struct Action {
        uint8 kind;
        uint8 horse;
        uint256 duration;
        int256 value;
        uint256 aux;
    }

    /// @dev Horse words: pos:u64, dist:u64, stamina:u64, finished:u1, blinded:u1.
    /// Equipment words: instance:u8, card:u8, expiry:u32. All bounds come from the engine's validated inputs/caps.
    /// Action words: kind:u8, horse:u8, duration:u32, value:i64, aux:u64.
    function plan(uint8 card, uint8 h, uint256[5] memory packedHorses, uint256[3] memory packedEquipment)
        internal
        pure
        returns (uint256[] memory packedActions, uint256 lootMs)
    {
        Horse[5] memory horses;
        Equipment[3] memory equipment;
        for (uint256 i; i < 5; ++i) {
            uint256 w = packedHorses[i];
            horses[i] = Horse(uint64(w), uint64(w >> 64), uint64(w >> 128), w & (1 << 192) != 0, w & (1 << 193) != 0);
        }
        for (uint256 i; i < 3; ++i) {
            uint256 w = packedEquipment[i];
            equipment[i] = Equipment(uint8(w), uint8(w >> 8), uint32(w >> 16));
        }
        PaidCardRules.Rule memory r = PaidCardRules.get(card);
        Action[] memory actions = new Action[](8);
        uint256 n;
        if (card == 22) {
            uint256 paid = horses[h].stamina < r.staminaMicro ? horses[h].stamina : r.staminaMicro;
            actions[n++] = Action(PAY, h, 0, int256(paid), 0);
            actions[n++] = Action(BUFF, h, r.durationMs, int256(uint256(uint32(r.pBps)) * paid / r.staminaMicro), 0);
        } else if (card == 23) {
            actions[n++] = Action(WATCH, h, r.durationMs, r.pBps, r.regenBonusBps);
        } else if (card == 24) {
            actions[n++] = Action(BUFF, h, r.periodMs, r.pBps, 0);
            actions[n++] = Action(WATCH, h, r.durationMs, 0, 0);
        } else if (card == 25 || card == 26 || card == 27 || card == 28 || card == 29 || card == 33) {
            actions[n++] = Action(GATE, h, r.durationMs, r.costDeltaBps, 0);
        } else if (card == 30) {
            uint256 old = 3;
            for (uint256 slot; slot < 3; ++slot) {
                Equipment memory e = equipment[slot];
                if (
                    e.id != 0
                        && (old == 3
                            || e.end < equipment[old].end
                            || (e.end == equipment[old].end && e.id < equipment[old].id))
                ) old = slot;
            }
            lootMs = old != 3 ? r.durationMs : r.periodMs;
            if (old != 3) {
                actions[n++] = Action(RECYCLE, h, 0, int256(equipment[old].id), 0);
                actions[n++] = Action(RECOVER, h, 0, int256(uint256(r.staminaMicro)), 0);
            }
            actions[n++] = Action(BUFF, h, lootMs, old != 3 ? r.pBps : r.fallbackBps, 0);
        } else if (card == 31) {
            actions[n++] = Action(BUFF, h, r.periodMs, r.pBps, 0);
            actions[n++] = Action(WATCH, h, PaidCardRules.PERMANENT_MS, 0, 0);
            for (uint256 slot; slot < 3; ++slot) {
                if (equipment[slot].id != 0) {
                    actions[n++] = Action(TINKER, h, 0, 0, 0);
                    break;
                }
            }
        } else if (card == 32) {
            for (uint256 slot; slot < 3; ++slot) {
                Equipment memory e = equipment[slot];
                if (e.id != 0) {
                    actions[n++] = Action(RENEW, h, PaidCardRules.get(e.cardId).durationMs, int256(e.id), 0);
                }
            }
            if (n == 0) {
                lootMs = r.periodMs;
                actions[n++] = Action(BUFF, h, lootMs, r.fallbackBps, 0);
            }
        } else if (card == 34) {
            actions[n++] = Action(BUFF, h, r.durationMs, r.pBps, 0);
            uint8 target = 255;
            for (uint8 id; id < 5; ++id) {
                Horse memory x = horses[id];
                if (id == h || x.finished || x.blinded || x.pos <= horses[h].pos) continue;
                if (target == 255 || x.pos < horses[target].pos) target = id;
            }
            actions[n++] = Action(TARGET, h, 0, int256(uint256(target)), 0);
            if (target != 255) actions[n++] = Action(BUFF, target, r.durationMs, r.fallbackBps, 0);
        } else if (card == 35) {
            bool first = true;
            for (uint8 id; id < 5; ++id) {
                Horse memory x = horses[id];
                if (id != h && (x.finished || x.pos > horses[h].pos || (x.pos == horses[h].pos && id < h))) {
                    first = false;
                }
            }
            actions[n++] = Action(BUFF, h, r.durationMs, first ? r.pBps : r.fallbackBps, 0);
        } else if (card == 36) {
            for (uint8 id; id < 5; ++id) {
                if (!horses[id].finished) actions[n++] = Action(RECOVER, id, 0, int256(uint256(r.staminaMicro)), 0);
            }
            actions[n++] = Action(BUFF, h, r.durationMs, r.pBps, 0);
        } else if (card == 37 || card == 38 || card == 39 || card == 40) {
            if (card == 39) actions[n++] = Action(BUFF, h, r.periodMs, r.pBps, 0);
            if (card == 40) actions[n++] = Action(FIXED, h, 0, r.fixedSpeed, 0);
            actions[n++] = Action(
                WATCH,
                h,
                card == 38 ? r.durationMs : PaidCardRules.PERMANENT_MS,
                0,
                card == 40 ? horses[h].dist + r.radiusMicro : 0
            );
        }
        packedActions = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            Action memory a = actions[i];
            packedActions[i] = uint256(a.kind) | uint256(a.horse) << 8 | a.duration << 16
                | uint256(uint64(int64(a.value))) << 48 | a.aux << 112;
        }
    }
}
