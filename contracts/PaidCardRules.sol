// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Generated from src/race/paid/cardRules.ts. Edit that source, then run bun scripts/gen-paid-card-rules.ts.
library PaidCardRules {
    error InvalidCard();

    bytes32 internal constant TABLE_HASH = 0x30dea918dfc50683a877ad59c4381a0ef3812ec44456f44a92a6960aaa9b4450;
    bytes32 internal constant RULESET_HASH = 0xeb03664a530fd6d5251118e5074b9bd2fa6c5cce60385d94779199160f45edd6;
    uint256 internal constant RARE_MASK = 0x12973e;
    uint256 internal constant CPU_MASK = 0x3fae3;
    uint32 internal constant PERMANENT_MS = type(uint32).max;
    uint32 internal constant BONUS_DEFAULT_MS = 20000;
    uint8 internal constant EFFECT_NONE = 0;
    uint8 internal constant EFFECT_AIRBORNE_SPEED = 1;
    uint8 internal constant EFFECT_SPEED_DEATH = 2;
    uint8 internal constant EFFECT_DRAW_CUT = 3;
    uint8 internal constant EFFECT_DRAW_AUTO = 4;
    uint8 internal constant EFFECT_REFRESH = 5;
    uint8 internal constant EFFECT_BOMB = 6;
    uint8 internal constant EFFECT_ROCKET = 7;
    uint8 internal constant EFFECT_RAINBOW = 8;
    uint8 internal constant EFFECT_SWAP = 9;
    uint8 internal constant EFFECT_GRAVITY = 10;
    uint8 internal constant EFFECT_WHEEL = 11;
    uint8 internal constant EFFECT_WIND = 12;
    uint8 internal constant EFFECT_STEAL = 13;
    uint8 internal constant EFFECT_REGEN = 14;
    uint8 internal constant EFFECT_ADRENALINE = 15;
    uint8 internal constant EFFECT_WIRED = 16;
    uint8 internal constant EFFECT_FIXED = 17;
    uint8 internal constant EFFECT_COAT = 18;
    uint8 internal constant EFFECT_BLIND_FIXED = 19;

    struct Rule {
        uint8 id;
        uint8 effect;
        bool rare;
        bool cpu;
        uint32 durationMs;
        uint8 bonusMode;
        int32 pBps;
        int16 fixedSpeed;
        uint32 staminaMicro;
        uint16 regenBonusBps;
        uint16 costMultiplierBps;
        uint8 slot;
        uint64 radiusMicro;
        uint16 strengthBps;
        int16 overlapBps;
        uint32 periodMs;
        uint8 count;
        uint16 bonusBps;
        uint8 autoPanelSec;
        uint32 coatRgb;
    }

    /// @notice keccak256(abi.encode(Rule[26])) of the TS table; PaidCardRules.t.sol recomputes it from get().
    bytes32 internal constant ENCODED_RULES_HASH = 0x1a06d5f0bc6ec40e64fcaf2107e4049bec48ea5eaa4856798a2d01d68f723cc1;

    function get(uint8 id) internal pure returns (Rule memory rule) {
        (uint256 hi, uint256 lo) = _packed(id);
        rule.id = uint8(hi >> 248);
        rule.effect = uint8(hi >> 240);
        rule.rare = uint8(hi >> 232) != 0;
        rule.cpu = uint8(hi >> 224) != 0;
        rule.durationMs = uint32(hi >> 192);
        rule.bonusMode = uint8(hi >> 184);
        rule.pBps = int32(uint32(hi >> 152));
        rule.fixedSpeed = int16(uint16(hi >> 136));
        rule.staminaMicro = uint32(hi >> 104);
        rule.regenBonusBps = uint16(hi >> 88);
        rule.costMultiplierBps = uint16(hi >> 72);
        rule.slot = uint8(hi >> 64);
        rule.radiusMicro = uint64(hi);
        rule.strengthBps = uint16(lo >> 112);
        rule.overlapBps = int16(uint16(lo >> 96));
        rule.periodMs = uint32(lo >> 64);
        rule.count = uint8(lo >> 56);
        rule.bonusBps = uint16(lo >> 40);
        rule.autoPanelSec = uint8(lo >> 32);
        rule.coatRgb = uint32(lo);
    }

    function _packed(uint8 id) private pure returns (uint256 hi, uint256 lo) {
        // C-01 airborneSpeed: effect=1 cpu=1 durationMs=30000 pBps=2000
        if (id == 1) {
            return
                (0x010100010000753000000007d000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-02 speedDeath: effect=2 rare=1 cpu=1 durationMs=30000 pBps=3000
        if (id == 2) {
            return
                (0x02020101000075300000000bb800000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-03 drawCut: effect=3 rare=1 durationMs=20000 pBps=4000
        if (id == 3) {
            return
                (0x0303010000004e200000000fa000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-04 drawAuto: effect=4 rare=1 durationMs=4294967295 bonusMode=2 bonusBps=2000 autoPanelSec=3
        if (id == 4) {
            return
                (0x04040100ffffffff020000000000000000000000000000ff0000000000000000, 0x00000000000000000007d00300000000);
        }
        // C-05 refresh: effect=5 rare=1 durationMs=4294967295 bonusMode=1 count=1
        if (id == 5) {
            return
                (0x05050100ffffffff010000000000000000000000000000ff0000000000000000, 0x00000000000000000100000000000000);
        }
        // C-06 bomb: effect=6 rare=1 cpu=1 durationMs=0 bonusMode=2
        if (id == 6) {
            return
                (0x0606010100000000020000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-07 rocket: effect=7 cpu=1 durationMs=40000 pBps=1500 costMultiplierBps=5000 slot=0
        if (id == 7) {
            return
                (0x0707000100009c4000000005dc00000000000000001388000000000000000000, 0x00000000000000000000000000000000);
        }
        // C-08 rainbow: effect=8 cpu=1 durationMs=60000 pBps=1000 slot=1
        if (id == 8) {
            return
                (0x080800010000ea6000000003e800000000000000000000010000000000000000, 0x00000000000000000000000000000000);
        }
        // C-09 swap: effect=9 rare=1 durationMs=30000 periodMs=2000 count=15
        if (id == 9) {
            return
                (0x0909010000007530000000000000000000000000000000ff0000000000000000, 0x00000000000007d00f00000000000000);
        }
        // C-10 gravity: effect=10 rare=1 cpu=1 durationMs=10000 slot=0 radiusMicro=8000000000 strengthBps=3000 overlapBps=3000
        if (id == 10) {
            return
                (0x0a0a0101000027100000000000000000000000000000000000000001dcd65000, 0x0bb80bb8000000000000000000000000);
        }
        // C-11 wheel: effect=11 rare=1 durationMs=30000 fixedSpeed=10 slot=2 periodMs=7000 count=4
        if (id == 11) {
            return
                (0x0b0b0100000075300000000000000a0000000000000000020000000000000000, 0x0000000000001b580400000000000000);
        }
        // C-12 wind: effect=12 cpu=1 durationMs=4294967295 bonusMode=1 strengthBps=1000
        if (id == 12) {
            return
                (0x0c0c0001ffffffff010000000000000000000000000000ff0000000000000000, 0x03e80000000000000000000000000000);
        }
        // C-13 steal: effect=13 rare=1 cpu=1 durationMs=0 bonusMode=3
        if (id == 13) {
            return
                (0x0d0d010100000000030000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-14 regen: effect=14 cpu=1 durationMs=5000 regenBonusBps=10000
        if (id == 14) {
            return
                (0x0e0e000100001388000000000000000000000027100000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-15 adrenaline: effect=15 cpu=1 durationMs=0 bonusMode=2 staminaMicro=200000000
        if (id == 15) {
            return
                (0x0f0f000100000000020000000000000bebc20000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-16 wired: effect=16 rare=1 cpu=1 durationMs=10000
        if (id == 16) {
            return
                (0x1010010100002710000000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-17 fixed: effect=17 cpu=1 durationMs=4294967295 bonusMode=1 fixedSpeed=10
        if (id == 17) {
            return
                (0x11110001ffffffff0100000000000a0000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-18 fixed: effect=17 rare=1 cpu=1 durationMs=4294967295 bonusMode=1 fixedSpeed=20
        if (id == 18) {
            return
                (0x12110101ffffffff010000000000140000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-19 coat: effect=18 durationMs=4294967295 bonusMode=1 coatRgb=16041282
        if (id == 19) {
            return
                (0x13120000ffffffff010000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000f4c542);
        }
        // C-20 coat: effect=18 durationMs=4294967295 bonusMode=1 coatRgb=6533962
        if (id == 20) {
            return
                (0x14120000ffffffff010000000000000000000000000000ff0000000000000000, 0x0000000000000000000000000063b34a);
        }
        // C-21 blindFixed: effect=19 rare=1 durationMs=4294967295 bonusMode=1 fixedSpeed=10
        if (id == 21) {
            return
                (0x15130100ffffffff0100000000000a0000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-22 none: durationMs=0 bonusMode=2
        if (id == 22) {
            return
                (0x1600000000000000020000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-23 none: durationMs=0 bonusMode=2
        if (id == 23) {
            return
                (0x1700000000000000020000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-24 none: durationMs=0 bonusMode=2
        if (id == 24) {
            return
                (0x1800000000000000020000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-25 none: durationMs=0 bonusMode=2
        if (id == 25) {
            return
                (0x1900000000000000020000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        // C-26 none: durationMs=0 bonusMode=2
        if (id == 26) {
            return
                (0x1a00000000000000020000000000000000000000000000ff0000000000000000, 0x00000000000000000000000000000000);
        }
        revert InvalidCard();
    }
}
