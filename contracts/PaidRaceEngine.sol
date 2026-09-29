// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "./IPaidRaceSolver.sol";
import {PaidCardRules} from "./PaidCardRules.sol";
import {PaidDrawRules} from "./PaidDrawRules.sol";
import {PaidProfiles} from "./PaidProfiles.sol";
import {PaidRaceMotion} from "./PaidRaceMotion.sol";
import {PaidRaceSupport} from "./PaidRaceSupport.sol";
import {PaidSwap} from "./PaidSwap.sol";
import {RaceEntropy} from "./RaceEntropy.sol";

/// @notice Solidity port of the paid ruleset v3 reference solver (src/race/paid/solver.ts). The TS solver is the
/// specification: every handler below mirrors its namesake there, in the same order, and folds the same event
/// digest. Memory only; card parameters come from the generated PaidCardRules table.
/// @dev Deviations are representation only: effect totals per horse are kept incrementally instead of looping over
/// instances, each instance caches its next due time, and the stretch between events runs in PaidRaceMotion. The
/// draw-rule transitions and the settlement run in PaidRaceSupport (Options.support) to keep PaidRaceSolver small.
library PaidRaceEngine {
    using PaidRaceMotion for PaidRaceMotion.Horse;

    // ------------------------------------------------------------ errors (TS error code in brackets)

    error InvalidHorse(); // INVALID_HORSE
    error InvalidProfiles(); // INVALID_PROFILES
    error InvalidDeck(); // INVALID_DECK
    error InvalidCpuDecks(); // INVALID_CPU_DECKS
    error InvalidOptions(); // INVALID_OPTIONS
    error NoAutopickAnchor(); // NO_AUTOPICK_ANCHOR
    error InstanceLimit(); // INSTANCE_LIMIT
    error BombLimit(); // BOMB_LIMIT
    error EventLimit(); // EVENT_LIMIT
    error OwnerLimit();

    // ------------------------------------------------------------ constants

    uint256 internal constant HORSES = 5;
    uint256 internal constant TRACK_MICRO = PaidRaceMotion.TRACK_MICRO;
    uint256 internal constant CHECKPOINT_MICRO = PaidRaceMotion.CHECKPOINT_MICRO;
    uint256 internal constant MAX_TAU = 600_000;
    uint256 internal constant UNFINISHED_TAU = 600_001;
    uint256 internal constant NEVER = PaidRaceMotion.NEVER;
    uint256 internal constant STAMINA_CAPACITY = PaidRaceMotion.STAMINA_CAPACITY;
    uint256 internal constant COST_PER_MS = PaidRaceMotion.COST_PER_MS;
    uint256 internal constant BPS = PaidRaceMotion.BPS;
    uint256 internal constant SLOW_FACTOR = 10;
    uint256 internal constant CHOICE_WINDOW_SEC = 20;
    uint256 internal constant RESPAWN_MS = 5_000;
    uint256 internal constant SWAP_EVENT_STRIDE = 256;
    uint256 internal constant MAX_INSTANCES = 64;
    uint256 internal constant MAX_BOMBS = 20;
    uint256 internal constant MAX_EVENTS = 4096;
    uint256 internal constant MAX_PROFILE_CAP = 1_000_000;
    uint256 internal constant NO_SLOT = 255;

    bytes32 internal constant PURPOSE_WIND = keccak256("wind");
    bytes32 internal constant PURPOSE_STEAL = keccak256("steal");

    // Event codes (src/race/paid/events.ts).
    uint256 internal constant EV_FINISH = 1;
    uint256 internal constant EV_CHECKPOINT = 2;
    uint256 internal constant EV_CARD = 3;
    uint256 internal constant EV_CPU_CARD_CUT = 4;
    uint256 internal constant EV_PANEL_OPEN = 5;
    uint256 internal constant EV_PANEL_AUTO = 6;
    uint256 internal constant EV_PANEL_CUT = 7;
    uint256 internal constant EV_PANEL_DEFER = 8;
    uint256 internal constant EV_PANEL_CLOSE = 9;
    uint256 internal constant EV_EXPIRE = 10;
    uint256 internal constant EV_EQUIP_ON = 11;
    uint256 internal constant EV_EQUIP_OFF = 12;
    uint256 internal constant EV_BOMB_PLACE = 13;
    uint256 internal constant EV_BOMB_EXPLODE = 14;
    uint256 internal constant EV_DEATH = 15;
    uint256 internal constant EV_DEATH_IMMUNE = 16;
    uint256 internal constant EV_RESPAWN_END = 17;
    uint256 internal constant EV_SWAP = 18;
    uint256 internal constant EV_SWAP_BLOCKED = 19;
    uint256 internal constant EV_WHEEL_BURST = 20;
    uint256 internal constant EV_WIND = 21;
    uint256 internal constant EV_STEAL = 22;
    uint256 internal constant EV_STEAL_NONE = 23;
    uint256 internal constant EV_EXHAUST_ENTER = 24;
    uint256 internal constant EV_EXHAUST_EXIT = 25;
    uint256 internal constant EV_OVERCAP_END = 26;
    uint256 internal constant EV_BASE_CAP = 27;
    uint256 internal constant EV_CHOICE_INVALID = 28;

    // CHOICE_INVALID reasons (arg = k·16 + reason); the draw-rule ones come from PaidDrawRules.classify.
    uint256 internal constant INVALID_NOT_OPENED = 1;
    uint256 internal constant INVALID_EARLY = 2;
    uint256 internal constant INVALID_LATE = 3;
    uint256 internal constant INVALID_AFTER_FINISH = 4;
    uint256 internal constant INVALID_AUTO = PaidDrawRules.INVALID_AUTO;
    uint256 internal constant INVALID_CUT = PaidDrawRules.INVALID_CUT;

    uint256 internal constant CLOSE_PICKED = 1;
    uint256 internal constant CLOSE_FORFEIT_TX = 2;
    uint256 internal constant CLOSE_TIMEOUT = 3;
    uint256 internal constant CLOSE_AUTO = 4;
    uint256 internal constant CLOSE_FINISHED = 5;

    uint256 internal constant OFF_EXPIRED = 0;
    uint256 internal constant OFF_REPLACED = 1;
    uint256 internal constant OFF_STOLEN = 2;

    uint256 internal constant KIND_BUFF = 0;
    uint256 internal constant KIND_EQUIP = 1;
    uint256 internal constant KIND_ABILITY = 2;
    uint256 internal constant KIND_RESPAWN = 3;
    uint256 internal constant KIND_BONUS = 4;

    uint256 internal constant MODE_NONE = 0;
    uint256 internal constant MODE_MANUAL = 1;
    uint256 internal constant MODE_AUTO = 2;
    uint256 internal constant MODE_CUT = 3;

    uint256 internal constant REASON_NOT_REACHED = 0;
    uint256 internal constant REASON_OPEN = 1;
    uint256 internal constant REASON_PICKED = 2;
    uint256 internal constant REASON_FORFEIT_TX = 3;
    uint256 internal constant REASON_TIMEOUT = 4;
    uint256 internal constant REASON_AUTO = 5;
    uint256 internal constant REASON_CUT = 6;
    uint256 internal constant REASON_FINISHED = 7;

    uint256 internal constant STATUS_COMPLETE = 0;
    uint256 internal constant STATUS_PANEL = 1;
    uint256 internal constant STATUS_WALL = 2;
    uint256 private constant STATUS_RUNNING = 3;

    uint256 private constant CLS_NONE = 7;

    // ------------------------------------------------------------ input and output

    /// @notice Fully explicit solver input (PaidCoreInput); cpuDecks[playerHorseId] is ignored.
    struct CoreInput {
        PaidProfiles.Profile[5] profiles;
        uint8 playerHorseId;
        uint8[14] playerDeck;
        uint8[3][5] cpuDecks;
        bytes32 seed;
        bytes32 openAnchor;
        IPaidRaceSolver.ChoiceInput[3] choices;
    }

    /// @notice PaidSolveOptions: stopAtPanel 0 = none; untilWall only when hasUntilWall; logEvents keeps the event list.
    struct Options {
        uint8 stopAtPanel;
        bool hasUntilWall;
        uint256 untilWall;
        bool logEvents;
        PaidRaceSupport support;
    }

    struct Record {
        bool reached;
        uint256 mode;
        uint256 openTau;
        uint256 openWall;
        uint256 openSec;
        uint256 deadlineSec;
        uint256 closeWall;
        uint256 closeTau;
        uint256 reason;
        uint256 cardId;
        uint256 candidateCount;
        uint8[3] candidates;
        /// @dev INVALID_* when a stored choice for this checkpoint was ignored, else 0.
        uint256 invalidReason;
    }

    struct PanelView {
        uint256 checkpoint;
        uint256 mode;
        uint256 openTau;
        uint256 openWall;
        uint256 openSec;
        uint256 deadlineSec;
        PaidDrawRules.State draw;
        uint256 candidateCount;
        uint8[3] candidates;
    }

    struct Result {
        uint256 status;
        uint256 tauEnd;
        uint256 wallEnd;
        bool hasPanel;
        PanelView panel;
        uint32[5] finishTime;
        uint32[5] finishWall;
        uint8[5] rawOrder;
        uint8[5] settlementOrder;
        uint8 rawRank;
        uint8 settlementRank;
        bool versionAnswer;
        uint8[3] acquiredByCheckpoint;
        Record[3] checkpoints;
        uint256 eventCount;
        bytes32 digest;
        uint256 stepCount;
        /// @dev Only with Options.logEvents: code | tau << 8 | horse << 40, and the arguments.
        uint256[] eventMeta;
        int256[] eventArgs;
    }

    // ------------------------------------------------------------ state

    struct Instance {
        uint256 owner;
        uint256 cardId;
        uint256 kind;
        uint256 slot;
        uint256 start;
        uint256 end;
        bool active;
        int256 pBps;
        uint256 regenBps;
        bool airborne;
        bool wired;
        bool halfCost;
        bool luck;
        bool well;
        bool wheel;
        bytes32 anchor;
        uint256 checkpoint;
        uint256 eventBase;
        uint256 count;
    }

    struct Panel {
        bool open;
        uint256 k;
        uint256 mode;
        uint256 openTau;
        uint256 openWall;
        uint256 openSec;
        uint256 closeWall;
        uint256 closeTau;
        /// @dev A stored choice for this manual panel passed the opening judgement and closes it at txSec.
        bool hasSlot;
    }

    /// @dev Card-table parameters the reference reads as module constants (src/race/paid/constants.ts).
    struct Params {
        uint256 rocketCost;
        uint256 adrenaline;
        int256 windBps;
        uint256 wheelDeltaV;
        uint256 autoPanelSec;
        uint256 swapPeriod;
        uint256 swapAttempts;
        uint256 wheelPeriod;
        uint256 wheelBursts;
        int256 bonusBps;
    }

    struct CardSource {
        bytes32 anchor;
        uint256 checkpoint;
        uint256 eventBase;
    }

    struct State {
        CoreInput input;
        PaidRaceSupport support;
        uint256 player;
        Params params;
        PaidRaceMotion.Horse[5] horses;
        PaidRaceMotion.Stretch stretch;
        Instance[64] instances;
        uint256 instanceCount;
        /// @dev Per instance: min(end, next trigger) while active, else NEVER; instMin is their minimum.
        uint256[64] instNext;
        uint256 instMin;
        bool instDirty;
        bool wellsDirty;
        PaidRaceMotion.Bomb[20] bombs;
        uint256 bombCount;
        uint256[5] laneLive;
        /// @dev Pending bomb hits from the last advance: horse | bomb << 8, done flag at bit 16.
        uint256[20] pending;
        uint256 pendingCount;
        int256 wind;
        uint256 windPlacer;
        PaidDrawRules.State draw;
        Panel panel;
        uint256 deferred;
        Record[3] records;
        bytes32 lastTxAnchor;
        bool hasLastTx;
        bool mapSlow;
        uint256 mapWall;
        uint256 mapTau;
        bytes32 digest;
        uint256 eventCount;
        bool logEvents;
        uint256[] eventMeta;
        int256[] eventArgs;
        uint256 stopAt;
        bool hasStopPanel;
        PanelView stopPanel;
        bool hasUntilWall;
        uint256 untilWall;
    }

    // ------------------------------------------------------------ entry points

    /// @notice solvePaidCore. Stored choices never make it revert (有奖规则 v3): only malformed profiles/decks, options
    /// and the unreachable instance/bomb/event/owner caps do.
    function solve(CoreInput memory input, Options memory opts) internal pure returns (Result memory) {
        _validate(input);
        if (opts.stopAtPanel > 3) revert InvalidOptions();
        State memory st = _createState(input, opts);
        uint256 tau;
        uint256 status = STATUS_COMPLETE;
        for (;;) {
            uint256 stop = _processMillisecond(st, tau);
            if (stop != STATUS_RUNNING) {
                status = stop;
                break;
            }
            if (_allFinished(st) || tau >= MAX_TAU) break;
            uint256 horizon = _nextKnownTau(st, tau);
            if (st.hasUntilWall) {
                (bool reached, uint256 limit) = _tauLimit(st, tau);
                if (reached) {
                    status = STATUS_WALL;
                    break;
                }
                if (limit < horizon) horizon = limit;
            }
            bool cut;
            (tau, cut) = PaidRaceMotion.advance(st.stretch, tau, horizon);
            st.pendingCount = 0;
            if (cut) _collectPending(st);
        }
        if (status == STATUS_COMPLETE) {
            // Choices the race never used: a panel that never opened, or one still open when τ hit 600000.
            for (uint256 k = 1; k <= 3; ++k) {
                if (!st.input.choices[k - 1].present) continue;
                if (st.records[k - 1].mode == MODE_NONE) {
                    _invalidChoice(st, k, tau, INVALID_NOT_OPENED);
                } else if (st.panel.open && st.panel.k == k && st.panel.hasSlot) {
                    _invalidChoice(st, k, tau, INVALID_AFTER_FINISH);
                }
            }
        }
        return _buildResult(st, status, tau);
    }

    // ------------------------------------------------------------ setup

    function _validate(CoreInput memory input) private pure {
        uint256 player = input.playerHorseId;
        if (player >= HORSES) revert InvalidHorse();
        for (uint256 h; h < HORSES; ++h) {
            PaidProfiles.Profile memory p = input.profiles[h];
            if (p.cap < p.base || p.cap > MAX_PROFILE_CAP) revert InvalidProfiles();
        }
        // Card ids 1..26, no repeats within a deck (bit id of `seen`).
        uint256 seen;
        for (uint256 i; i < 14; ++i) {
            uint256 id = input.playerDeck[i];
            if (id == 0 || id > 26 || (seen >> id) & 1 != 0) revert InvalidDeck();
            seen |= uint256(1) << id;
        }
        for (uint256 h; h < HORSES; ++h) {
            if (h == player) continue;
            uint256 cpuSeen;
            for (uint256 i; i < 3; ++i) {
                uint256 id = input.cpuDecks[h][i];
                if (id == 0 || id > 26 || (cpuSeen >> id) & 1 != 0) revert InvalidCpuDecks();
                cpuSeen |= uint256(1) << id;
            }
        }
    }

    function _createState(CoreInput memory input, Options memory opts) private pure returns (State memory st) {
        st.input = input;
        st.support = opts.support;
        st.player = input.playerHorseId;
        _loadParams(st);
        for (uint256 h; h < HORSES; ++h) {
            PaidRaceMotion.Horse memory horse = st.horses[h];
            PaidProfiles.Profile memory p = input.profiles[h];
            horse.accel = p.acceleration;
            horse.capMilli = uint256(p.cap) * 1000;
            horse.b = uint256(p.base) * 1000;
            horse.s = STAMINA_CAPACITY;
            horse.lane = h;
            horse.finishTime = UNFINISHED_TAU;
            horse.finishWall = NEVER;
        }
        for (uint256 i; i < MAX_INSTANCES; ++i) {
            st.instNext[i] = NEVER;
        }
        st.instMin = NEVER;
        st.draw = PaidDrawRules.initial();
        st.stopAt = opts.stopAtPanel;
        st.hasUntilWall = opts.hasUntilWall;
        st.untilWall = opts.untilWall;
        st.logEvents = opts.logEvents;
        if (opts.logEvents) {
            st.eventMeta = new uint256[](MAX_EVENTS);
            st.eventArgs = new int256[](MAX_EVENTS);
        }
    }

    function _loadParams(State memory st) private pure {
        Params memory p = st.params;
        PaidCardRules.Rule memory rocket = PaidCardRules.get(7);
        p.rocketCost = COST_PER_MS * rocket.costMultiplierBps / BPS;
        st.stretch.rocketCost = p.rocketCost;
        p.adrenaline = PaidCardRules.get(15).staminaMicro;
        PaidCardRules.Rule memory well = PaidCardRules.get(10);
        st.stretch.radius = well.radiusMicro;
        st.stretch.strength = well.strengthBps;
        st.stretch.overlap = well.overlapBps;
        p.windBps = int256(uint256(PaidCardRules.get(12).strengthBps));
        PaidCardRules.Rule memory wheel = PaidCardRules.get(11);
        p.wheelDeltaV = uint256(int256(wheel.fixedSpeed));
        p.wheelPeriod = wheel.periodMs;
        p.wheelBursts = wheel.count;
        PaidCardRules.Rule memory auto_ = PaidCardRules.get(4);
        p.autoPanelSec = auto_.autoPanelSec;
        p.bonusBps = int256(uint256(auto_.bonusBps));
        PaidCardRules.Rule memory swap = PaidCardRules.get(9);
        p.swapPeriod = swap.periodMs;
        p.swapAttempts = swap.count;
    }

    // ------------------------------------------------------------ bookkeeping

    /// @dev emit(): digest = keccak256(abi.encode(bytes32 digest, uint8 code, uint32 tau, uint8 horse, int256 arg)).
    function _log(State memory st, uint256 code, uint256 tau, uint256 horse, int256 arg) private pure {
        uint256 count = st.eventCount;
        if (count >= MAX_EVENTS) revert EventLimit();
        bytes32 digest = st.digest;
        // code <= 28, tau <= 600000 and horse <= 4 already fit uint8/uint32/uint8, so the words equal abi.encode.
        assembly ("memory-safe") {
            let p := mload(0x40)
            mstore(p, digest)
            mstore(add(p, 0x20), code)
            mstore(add(p, 0x40), tau)
            mstore(add(p, 0x60), horse)
            mstore(add(p, 0x80), arg)
            digest := keccak256(p, 0xa0)
        }
        st.digest = digest;
        if (st.logEvents) {
            st.eventMeta[count] = code | (tau << 8) | (horse << 40);
            st.eventArgs[count] = arg;
        }
        st.eventCount = count + 1;
    }

    function _wallAt(State memory st, uint256 tau) private pure returns (uint256) {
        return st.mapWall + (tau - st.mapTau) * (st.mapSlow ? SLOW_FACTOR : 1);
    }

    function _setMapping(State memory st, uint256 tau, uint256 wall, bool slow) private pure {
        st.mapSlow = slow;
        st.mapWall = wall;
        st.mapTau = tau;
    }

    function _respawning(PaidRaceMotion.Horse memory horse) private pure returns (bool) {
        return horse.aggRespawn != 0;
    }

    function _addInstance(State memory st, uint256 tau, uint256 owner, uint256 cardId, uint256 kind, uint256 duration)
        private
        pure
        returns (Instance memory inst, uint256 id)
    {
        uint256 index = st.instanceCount;
        if (index >= MAX_INSTANCES) revert InstanceLimit();
        st.instanceCount = index + 1;
        id = index + 1;
        inst = st.instances[index];
        inst.owner = owner;
        inst.cardId = cardId;
        inst.kind = kind;
        inst.slot = NO_SLOT;
        inst.start = tau;
        inst.end = duration == NEVER ? NEVER : tau + duration;
        inst.active = true;
        if (kind == KIND_RESPAWN) st.horses[owner].aggRespawn += 1;
    }

    /// @dev Registers the totals and due time of a freshly configured instance (the tail of addInstance).
    function _activate(State memory st, Instance memory inst, uint256 id) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[inst.owner];
        horse.aggP += inst.pBps;
        horse.aggRegen += inst.regenBps;
        if (inst.halfCost) horse.aggHalfCost += 1;
        if (inst.airborne) horse.aggAirborne += 1;
        if (inst.wired) horse.aggWired += 1;
        if (inst.well) st.wellsDirty = true;
        uint256 next = _instanceNext(st, inst);
        st.instNext[id - 1] = next;
        if (next < st.instMin) st.instMin = next;
    }

    function _endInstance(State memory st, Instance memory inst, uint256 id) private pure {
        inst.active = false;
        PaidRaceMotion.Horse memory horse = st.horses[inst.owner];
        if (inst.slot != NO_SLOT && horse.equipOf(inst.slot) == id) horse.setEquip(inst.slot, 0);
        horse.aggP -= inst.pBps;
        horse.aggRegen -= inst.regenBps;
        if (inst.halfCost) horse.aggHalfCost -= 1;
        if (inst.airborne) horse.aggAirborne -= 1;
        if (inst.wired) horse.aggWired -= 1;
        if (inst.kind == KIND_RESPAWN) horse.aggRespawn -= 1;
        if (inst.well) st.wellsDirty = true;
        st.instNext[id - 1] = NEVER;
        st.instDirty = true;
    }

    /// @dev Earliest time the instance is due in findDue class 0 (end) or class 4 (next trigger).
    function _instanceNext(State memory st, Instance memory inst) private pure returns (uint256 next) {
        if (!inst.active) return NEVER;
        next = inst.end;
        uint256 trigger = _triggerAt(st, inst);
        if (trigger < next) next = trigger;
    }

    function _triggerAt(State memory st, Instance memory inst) private pure returns (uint256) {
        if (inst.kind == KIND_ABILITY && inst.count < st.params.swapAttempts) {
            return inst.start + st.params.swapPeriod * inst.count;
        }
        if (inst.kind == KIND_EQUIP && inst.wheel && inst.count < st.params.wheelBursts) {
            return inst.start + st.params.wheelPeriod * (inst.count + 1);
        }
        return NEVER;
    }

    function _instMin(State memory st) private pure returns (uint256 m) {
        if (!st.instDirty) return st.instMin;
        uint256[64] memory next = st.instNext;
        uint256 count = st.instanceCount;
        m = NEVER;
        assembly ("memory-safe") {
            let end := add(next, shl(5, count))
            for { let p := next } lt(p, end) { p := add(p, 0x20) } {
                let v := mload(p)
                if lt(v, m) { m := v }
            }
        }
        st.instMin = m;
        st.instDirty = false;
    }

    // ------------------------------------------------------------ due scan

    /// @notice findDue: the smallest (class, key) due at `tau`, or CLS_NONE. Keys: instance index (0, 4), horse
    /// (2, 5), horse·2 + sub (1), pending index (3).
    function _findDue(State memory st, uint256 tau) private pure returns (uint256 cls, uint256 key) {
        bool instDue = _instMin(st) == tau;
        uint256 count = st.instanceCount;
        if (instDue) {
            for (uint256 i; i < count; ++i) {
                if (st.instNext[i] != tau) continue;
                Instance memory inst = st.instances[i];
                if (inst.end == tau) return (0, i);
            }
        }
        (uint256 cls1, uint256 cls2, uint256 cls5) = PaidRaceMotion.horseDues(st.horses, st.params.rocketCost);
        if (cls1 != PaidRaceMotion.NONE) return (1, cls1);
        if (cls2 != PaidRaceMotion.NONE) return (2, cls2);
        uint256 pendingCount = st.pendingCount;
        for (uint256 i; i < pendingCount; ++i) {
            if (st.pending[i] & (1 << 16) == 0) return (3, i);
        }
        if (instDue) {
            for (uint256 i; i < count; ++i) {
                if (st.instNext[i] != tau) continue;
                if (_triggerAt(st, st.instances[i]) == tau) return (4, i);
            }
        }
        if (cls5 != PaidRaceMotion.NONE) return (5, cls5);
        if (st.panel.open && st.panel.closeTau == tau) return (6, 0);
        return (CLS_NONE, 0);
    }

    function _processMillisecond(State memory st, uint256 tau) private pure returns (uint256 status) {
        for (;;) {
            (uint256 cls, uint256 key) = _findDue(st, tau);
            if (cls == CLS_NONE) return STATUS_RUNNING;
            if (st.hasUntilWall) {
                uint256 stamp = cls == 6 ? st.panel.closeWall : _wallAt(st, tau);
                if (stamp > st.untilWall) return STATUS_WALL;
            }
            _applyDue(st, cls, key, tau);
            if (st.hasStopPanel) return STATUS_PANEL;
        }
    }

    // ------------------------------------------------------------ event handlers

    function _applyDue(State memory st, uint256 cls, uint256 key, uint256 tau) private pure {
        if (cls == 0) return _expire(st, key, tau);
        if (cls == 1) return _threshold(st, key >> 1, key & 1, tau);
        if (cls == 2) return _finish(st, key, tau);
        if (cls == 3) return _bomb(st, key, tau);
        if (cls == 4) return _trigger(st, key, tau);
        if (cls == 5) return _checkpoint(st, key, tau);
        _closePanel(st, tau);
    }

    function _expire(State memory st, uint256 index, uint256 tau) private pure {
        Instance memory inst = st.instances[index];
        uint256 id = index + 1;
        _endInstance(st, inst, id);
        if (inst.kind == KIND_EQUIP) {
            _log(st, EV_EQUIP_OFF, tau, inst.owner, int256(id * 4 + OFF_EXPIRED));
        } else if (inst.kind == KIND_RESPAWN) {
            _log(st, EV_RESPAWN_END, tau, inst.owner, int256(id));
        } else {
            _log(st, EV_EXPIRE, tau, inst.owner, int256(id));
        }
        if (inst.luck) _kill(st, inst.owner, tau);
    }

    function _threshold(State memory st, uint256 h, uint256 sub, uint256 tau) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        if (sub == 0) {
            horse.b = horse.capMilli;
            horse.atCap = true;
            _log(st, EV_BASE_CAP, tau, h, int256(horse.b));
        } else if (horse.exhausted) {
            horse.exhausted = false;
            horse.overcap = horse.s > STAMINA_CAPACITY;
            _log(st, EV_EXHAUST_EXIT, tau, h, int256(horse.s));
        } else if (horse.overcap) {
            horse.overcap = false;
            _log(st, EV_OVERCAP_END, tau, h, int256(horse.s));
        } else {
            horse.s = 0;
            horse.exhausted = true;
            _log(st, EV_EXHAUST_ENTER, tau, h, 0);
        }
    }

    function _bomb(State memory st, uint256 index, uint256 tau) private pure {
        uint256 entry = st.pending[index];
        st.pending[index] = entry | (1 << 16);
        uint256 h = entry & 0xff;
        uint256 id = (entry >> 8) & 0xff;
        PaidRaceMotion.Bomb memory bomb = st.bombs[id];
        if (!bomb.live || st.horses[h].finished) return;
        bomb.live = false;
        st.laneLive[bomb.lane] &= ~(uint256(1) << id);
        _log(st, EV_BOMB_EXPLODE, tau, h, int256(id));
        _kill(st, h, tau);
    }

    function _trigger(State memory st, uint256 index, uint256 tau) private pure {
        Instance memory inst = st.instances[index];
        if (inst.kind == KIND_ABILITY) {
            _swapAttempt(st, inst, index, tau);
        } else {
            inst.count += 1;
            _touch(st, inst, index);
            st.horses[inst.owner].fixedK += st.params.wheelDeltaV;
            _log(st, EV_WHEEL_BURST, tau, inst.owner, int256(inst.count));
        }
    }

    /// @dev Re-derives an instance's due time after its trigger counter moved.
    function _touch(State memory st, Instance memory inst, uint256 index) private pure {
        st.instNext[index] = _instanceNext(st, inst);
        st.instDirty = true;
    }

    function _kill(State memory st, uint256 h, uint256 tau) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        if (_respawning(horse)) {
            _log(st, EV_DEATH_IMMUNE, tau, h, 0);
            return;
        }
        horse.b = 0;
        horse.fixedK = 0;
        horse.atCap = false;
        (Instance memory respawn, uint256 id) = _addInstance(st, tau, h, 0, KIND_RESPAWN, RESPAWN_MS);
        _activate(st, respawn, id);
        _log(st, EV_DEATH, tau, h, int256(id));
    }

    function _swapAttempt(State memory st, Instance memory inst, uint256 index, uint256 tau) private pure {
        uint256 attempt = inst.count;
        inst.count = attempt + 1;
        _touch(st, inst, index);
        PaidSwap.Horse[5] memory view_;
        for (uint256 h; h < HORSES; ++h) {
            PaidRaceMotion.Horse memory horse = st.horses[h];
            view_[h] = PaidSwap.Horse(
                uint8(horse.lane), uint64(horse.pos), uint64(horse.dist), horse.finished, horse.blindedPro
            );
        }
        uint256 eventIndex = inst.eventBase * SWAP_EVENT_STRIDE + attempt;
        (PaidSwap.Horse[5] memory next, uint8 target, bool swapped) =
            PaidSwap.swap(view_, uint8(inst.owner), st.input.seed, inst.anchor, uint8(inst.checkpoint), eventIndex);
        int256 arg = int256(attempt * 8 + target);
        if (!swapped) {
            _log(st, EV_SWAP_BLOCKED, tau, inst.owner, arg);
            return;
        }
        PaidRaceMotion.Horse memory owner = st.horses[inst.owner];
        owner.pos = next[inst.owner].pos;
        owner.lane = next[inst.owner].laneIndex;
        PaidRaceMotion.Horse memory other = st.horses[target];
        other.pos = next[target].pos;
        other.lane = next[target].laneIndex;
        _log(st, EV_SWAP, tau, inst.owner, arg);
    }

    function _finish(State memory st, uint256 h, uint256 tau) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        horse.finished = true;
        horse.finishTime = tau;
        horse.finishWall = _wallAt(st, tau);
        _log(st, EV_FINISH, tau, h, int256(horse.pos));
        uint256 count = st.instanceCount;
        for (uint256 i; i < count; ++i) {
            Instance memory inst = st.instances[i];
            if (inst.active && inst.owner == h) _endInstance(st, inst, i + 1);
        }
        if (h != st.player) return;
        uint256 stamp = _wallAt(st, tau);
        if (st.deferred != 0) {
            for (uint256 k = st.deferred; k <= horse.cp; ++k) {
                _finishRecord(st.records[k - 1], stamp, tau);
            }
        }
        st.deferred = 0;
        Panel memory panel = st.panel;
        if (!panel.open) return;
        _finishRecord(st.records[panel.k - 1], stamp, tau);
        panel.open = false;
        _setMapping(st, tau, stamp, false);
        _log(st, EV_PANEL_CLOSE, tau, h, int256(panel.k * 16 + CLOSE_FINISHED));
        // The player reached the line before txSec (txSec·1000 >= finishWall): the choice never took effect.
        if (panel.hasSlot) _invalidChoice(st, panel.k, tau, INVALID_AFTER_FINISH);
    }

    function _finishRecord(Record memory rec, uint256 stamp, uint256 tau) private pure {
        rec.reason = REASON_FINISHED;
        rec.closeWall = stamp;
        rec.closeTau = tau;
    }

    function _checkpoint(State memory st, uint256 h, uint256 tau) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        uint256 k = horse.cp + 1;
        horse.cp = k;
        _log(st, EV_CHECKPOINT, tau, h, int256(k));
        if (h != st.player) {
            if (horse.drawCut) {
                _log(st, EV_CPU_CARD_CUT, tau, h, int256(k));
            } else {
                CardSource memory src = CardSource(st.input.openAnchor, 0, h * 3 + k - 1);
                _applyCard(st, h, st.input.cpuDecks[h][k - 1], src, tau);
            }
            return;
        }
        if (st.panel.open) {
            st.records[k - 1].reached = true;
            if (st.deferred == 0) st.deferred = k;
            _log(st, EV_PANEL_DEFER, tau, h, int256(k));
            return;
        }
        _openPanel(st, k, tau);
    }

    // ------------------------------------------------------------ cards

    function _applyCard(State memory st, uint256 h, uint256 cardId, CardSource memory src, uint256 tau) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        PaidCardRules.Rule memory rule = PaidCardRules.get(uint8(cardId));
        _log(st, EV_CARD, tau, h, int256(cardId));
        uint256 lootMs;
        uint8 effect = rule.effect;
        if (
            effect == PaidCardRules.EFFECT_AIRBORNE_SPEED || effect == PaidCardRules.EFFECT_SPEED_DEATH
                || effect == PaidCardRules.EFFECT_DRAW_CUT || effect == PaidCardRules.EFFECT_REGEN
                || effect == PaidCardRules.EFFECT_WIRED
        ) {
            // Timed buffs; each effect reads only the table field the reference reads for it.
            (Instance memory inst, uint256 id) = _addInstance(st, tau, h, cardId, KIND_BUFF, rule.durationMs);
            if (effect == PaidCardRules.EFFECT_REGEN) inst.regenBps = rule.regenBonusBps;
            else if (effect != PaidCardRules.EFFECT_WIRED) inst.pBps = rule.pBps;
            inst.airborne = effect == PaidCardRules.EFFECT_AIRBORNE_SPEED;
            inst.luck = effect == PaidCardRules.EFFECT_SPEED_DEATH;
            inst.wired = effect == PaidCardRules.EFFECT_WIRED;
            _activate(st, inst, id);
            if (effect == PaidCardRules.EFFECT_DRAW_CUT) horse.drawCut = true;
            if (effect == PaidCardRules.EFFECT_WIRED && horse.exhausted) {
                horse.exhausted = false;
                horse.overcap = false;
                _log(st, EV_EXHAUST_EXIT, tau, h, int256(horse.s));
            }
        } else if (effect == PaidCardRules.EFFECT_BOMB) {
            _placeBombs(st, h, tau);
        } else if (
            effect == PaidCardRules.EFFECT_ROCKET || effect == PaidCardRules.EFFECT_RAINBOW
                || effect == PaidCardRules.EFFECT_GRAVITY || effect == PaidCardRules.EFFECT_WHEEL
        ) {
            _equip(st, h, rule, tau);
        } else if (effect == PaidCardRules.EFFECT_SWAP) {
            (Instance memory inst, uint256 id) = _addInstance(st, tau, h, cardId, KIND_ABILITY, rule.durationMs);
            inst.anchor = src.anchor;
            inst.checkpoint = src.checkpoint;
            inst.eventBase = src.eventBase;
            _activate(st, inst, id);
        } else if (effect == PaidCardRules.EFFECT_WIND) {
            uint256 draw =
                RaceEntropy.derive(st.input.seed, src.anchor, uint8(src.checkpoint), PURPOSE_WIND, src.eventBase);
            st.wind = draw % 2 == 0 ? -st.params.windBps : st.params.windBps;
            st.windPlacer = h;
            _log(st, EV_WIND, tau, h, st.wind);
        } else if (effect == PaidCardRules.EFFECT_STEAL) {
            lootMs = _steal(st, h, src, tau);
        } else if (effect == PaidCardRules.EFFECT_ADRENALINE) {
            horse.s += st.params.adrenaline;
            if (!horse.exhausted) horse.overcap = horse.s > STAMINA_CAPACITY;
        } else if (effect == PaidCardRules.EFFECT_FIXED || effect == PaidCardRules.EFFECT_BLIND_FIXED) {
            horse.fixedK += uint256(int256(rule.fixedSpeed));
            if (effect == PaidCardRules.EFFECT_BLIND_FIXED) horse.blindedPro = true;
        }
        if (horse.bonus) {
            (Instance memory bonus, uint256 id) =
                _addInstance(st, tau, h, cardId, KIND_BONUS, _bonusDuration(rule, lootMs));
            bonus.pBps = st.params.bonusBps;
            _activate(st, bonus, id);
        }
        if (effect == PaidCardRules.EFFECT_DRAW_AUTO) horse.bonus = true;
    }

    /// @notice bonusDurationMs: C-04 bonus length (NEVER = permanent); lootMs is the stolen equipment's duration.
    function _bonusDuration(PaidCardRules.Rule memory rule, uint256 lootMs) private pure returns (uint256) {
        if (rule.bonusMode == 0) return rule.durationMs;
        if (rule.bonusMode == 1) return NEVER;
        if (rule.bonusMode == 3 && lootMs > 0) return lootMs;
        return PaidCardRules.BONUS_DEFAULT_MS;
    }

    /// @notice equip: replaces the slot's instance and returns the new instance's full duration.
    function _equip(State memory st, uint256 h, PaidCardRules.Rule memory rule, uint256 tau)
        private
        pure
        returns (uint256 duration)
    {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        uint256 slot = rule.slot;
        duration = rule.durationMs;
        uint256 oldId = horse.equipOf(slot);
        if (oldId != 0) {
            _endInstance(st, st.instances[oldId - 1], oldId);
            _log(st, EV_EQUIP_OFF, tau, h, int256(oldId * 4 + OFF_REPLACED));
        }
        (Instance memory inst, uint256 id) = _addInstance(st, tau, h, rule.id, KIND_EQUIP, duration);
        inst.slot = slot;
        uint8 effect = rule.effect;
        if (effect == PaidCardRules.EFFECT_ROCKET) {
            inst.pBps = rule.pBps;
            inst.halfCost = true;
        } else if (effect == PaidCardRules.EFFECT_RAINBOW) {
            inst.pBps = rule.pBps;
        } else if (effect == PaidCardRules.EFFECT_GRAVITY) {
            inst.well = true;
        } else {
            inst.airborne = true;
            inst.wheel = true;
        }
        _activate(st, inst, id);
        horse.setEquip(slot, id);
        _log(st, EV_EQUIP_ON, tau, h, int256(id));
    }

    function _placeBombs(State memory st, uint256 h, uint256 tau) private pure {
        PaidRaceMotion.Horse memory placer = st.horses[h];
        for (uint256 lane; lane < HORSES; ++lane) {
            if (lane == placer.lane) continue;
            uint256 id = st.bombCount;
            if (id >= MAX_BOMBS) revert BombLimit();
            st.bombCount = id + 1;
            PaidRaceMotion.Bomb memory bomb = st.bombs[id];
            bomb.lane = lane;
            bomb.pos = placer.pos;
            bomb.placer = h;
            bomb.live = true;
            st.laneLive[lane] |= uint256(1) << id;
            _log(st, EV_BOMB_PLACE, tau, h, int256(placer.pos * 8 + lane));
        }
    }

    function _steal(State memory st, uint256 h, CardSource memory src, uint256 tau) private pure returns (uint256) {
        uint256[15] memory candidates;
        uint256 n;
        for (uint256 victim; victim < HORSES; ++victim) {
            PaidRaceMotion.Horse memory horse = st.horses[victim];
            if (victim == h || horse.finished) continue;
            for (uint256 slot; slot < 3; ++slot) {
                uint256 id = horse.equipOf(slot);
                if (id != 0) candidates[n++] = id;
            }
        }
        if (n == 0) {
            _log(st, EV_STEAL_NONE, tau, h, 0);
            return 0;
        }
        uint256 pick =
            RaceEntropy.derive(st.input.seed, src.anchor, uint8(src.checkpoint), PURPOSE_STEAL, src.eventBase) % n;
        uint256 lootId = candidates[pick];
        Instance memory loot = st.instances[lootId - 1];
        _log(st, EV_STEAL, tau, h, int256(lootId));
        _endInstance(st, loot, lootId);
        _log(st, EV_EQUIP_OFF, tau, loot.owner, int256(lootId * 4 + OFF_STOLEN));
        return _equip(st, h, PaidCardRules.get(uint8(loot.cardId)), tau);
    }

    // ------------------------------------------------------------ panels

    function _candidatesAt(State memory st) private pure returns (uint8[3] memory offer) {
        uint256 cursor = st.draw.cursor;
        for (uint256 i; i < 3; ++i) {
            offer[i] = st.input.playerDeck[cursor + i];
        }
    }

    function _panelView(State memory st, Panel memory panel) private pure returns (PanelView memory v) {
        v.checkpoint = panel.k;
        v.mode = panel.mode;
        v.openTau = panel.openTau;
        v.openWall = panel.openWall;
        v.openSec = panel.openSec;
        v.deadlineSec = panel.openSec + (panel.mode == MODE_AUTO ? st.params.autoPanelSec : CHOICE_WINDOW_SEC);
        v.draw = _copyDraw(st.draw);
        v.candidateCount = 3;
        v.candidates = _candidatesAt(st);
    }

    function _copyDraw(PaidDrawRules.State memory d) private pure returns (PaidDrawRules.State memory) {
        return PaidDrawRules.State(d.cursor, d.tailCursor, d.refreshCredits, d.automatic, d.forfeited);
    }

    /// @notice invalidChoice: the stored choice for checkpoint k counts as no transaction (有奖规则 v3).
    function _invalidChoice(State memory st, uint256 k, uint256 tau, uint256 reason) private pure {
        st.records[k - 1].invalidReason = reason;
        _log(st, EV_CHOICE_INVALID, tau, st.player, int256(k * 16 + reason));
    }

    /// @notice openPanel. A stored choice is judged here, before the close time is fixed: cut, auto, outside
    /// [openSec, openSec + 20), then the refresh and card rules; an invalid one is dropped, so the panel is cut, auto or
    /// times out exactly as without a transaction.
    function _openPanel(State memory st, uint256 k, uint256 tau) private pure {
        uint256 stamp = _wallAt(st, tau);
        Record memory rec = st.records[k - 1];
        IPaidRaceSolver.ChoiceInput memory slot = st.input.choices[k - 1];
        rec.reached = true;
        rec.openTau = tau;
        rec.openWall = stamp;
        if (st.draw.forfeited) {
            rec.mode = MODE_CUT;
            rec.reason = REASON_CUT;
            rec.closeWall = stamp;
            rec.closeTau = tau;
            _log(st, EV_PANEL_CUT, tau, st.player, int256(k));
            if (slot.present) _invalidChoice(st, k, tau, INVALID_CUT);
            if (st.stopAt == k) {
                st.hasStopPanel = true;
                PanelView memory v = st.stopPanel;
                v.checkpoint = k;
                v.mode = MODE_CUT;
                v.openTau = tau;
                v.openWall = stamp;
                v.draw = _copyDraw(st.draw);
            }
            return;
        }
        uint256 openSec = (stamp + 999) / 1000;
        uint256 invalid;
        bool hasSlot = slot.present;
        if (hasSlot) {
            if (st.draw.automatic) {
                invalid = INVALID_AUTO;
            } else if (slot.txSec < openSec) {
                invalid = INVALID_EARLY;
            } else if (slot.txSec >= openSec + CHOICE_WINDOW_SEC) {
                invalid = INVALID_LATE;
            } else {
                invalid = st.support.classifyChoice(st.input.playerDeck, st.draw, slot.refreshSlots, slot.cardId);
            }
            hasSlot = invalid == 0;
        }
        uint256 mode = st.draw.automatic ? MODE_AUTO : MODE_MANUAL;
        uint256 closeWall;
        if (mode == MODE_AUTO) {
            closeWall = (openSec + st.params.autoPanelSec) * 1000;
        } else {
            closeWall = hasSlot ? uint256(slot.txSec) * 1000 : (openSec + CHOICE_WINDOW_SEC) * 1000;
        }
        Panel memory panel = st.panel;
        panel.open = true;
        panel.k = k;
        panel.mode = mode;
        panel.openTau = tau;
        panel.openWall = stamp;
        panel.openSec = openSec;
        panel.closeWall = closeWall;
        panel.closeTau = tau + (closeWall - stamp) / SLOW_FACTOR;
        panel.hasSlot = hasSlot;
        rec.mode = mode;
        rec.reason = REASON_OPEN;
        rec.openSec = openSec;
        rec.deadlineSec = openSec + (mode == MODE_AUTO ? st.params.autoPanelSec : CHOICE_WINDOW_SEC);
        rec.candidateCount = 3;
        rec.candidates = _candidatesAt(st);
        _setMapping(st, tau, stamp, true);
        _log(st, mode == MODE_AUTO ? EV_PANEL_AUTO : EV_PANEL_OPEN, tau, st.player, int256(k));
        if (invalid != 0) _invalidChoice(st, k, tau, invalid);
        if (st.stopAt == k) {
            st.hasStopPanel = true;
            st.stopPanel = _panelView(st, panel);
        }
    }

    function _closePanel(State memory st, uint256 tau) private pure {
        Panel memory panel = st.panel;
        uint256 k = panel.k;
        Record memory rec = st.records[k - 1];
        uint256 cardId;
        uint256 reason;
        uint256 code;
        CardSource memory src;
        uint8[3] memory offer = _candidatesAt(st);
        if (panel.mode == MODE_AUTO) {
            if (!st.hasLastTx) revert NoAutopickAnchor();
            (st.draw, cardId) = _drawTransition(st, new uint8[](0), 0, k);
            reason = REASON_AUTO;
            code = CLOSE_AUTO;
            src = CardSource(st.lastTxAnchor, k, 0);
        } else if (panel.hasSlot) {
            IPaidRaceSolver.ChoiceInput memory slot = st.input.choices[k - 1];
            uint256 tail = st.draw.tailCursor;
            (st.draw,) = _drawTransition(st, slot.refreshSlots, slot.cardId, k);
            // offeredAfterRefresh against the draw state before this choice (the transition validated the slots).
            for (uint256 i; i < slot.refreshSlots.length; ++i) {
                offer[slot.refreshSlots[i]] = st.input.playerDeck[--tail];
            }
            cardId = slot.cardId;
            reason = cardId == 0 ? REASON_FORFEIT_TX : REASON_PICKED;
            code = cardId == 0 ? CLOSE_FORFEIT_TX : CLOSE_PICKED;
            st.lastTxAnchor = slot.anchor;
            st.hasLastTx = true;
            src = CardSource(slot.anchor, k, 0);
        } else {
            (st.draw,) = _drawTransition(st, new uint8[](0), 0, k);
            reason = REASON_TIMEOUT;
            code = CLOSE_TIMEOUT;
        }
        rec.reason = reason;
        rec.cardId = cardId;
        rec.closeWall = panel.closeWall;
        rec.closeTau = tau;
        rec.candidateCount = 3;
        rec.candidates = offer;
        panel.open = false;
        _setMapping(st, tau, panel.closeWall, false);
        _log(st, EV_PANEL_CLOSE, tau, st.player, int256(k * 16 + code));
        if (cardId != 0) _applyCard(st, st.player, cardId, src, tau);
        _openDeferred(st, tau);
    }

    /// @dev applyPaidChoice / resolvePaidAutomaticChoice, run in PaidRaceSupport.
    function _drawTransition(State memory st, uint8[] memory refreshSlots, uint256 chosenId, uint256 k)
        private
        pure
        returns (PaidDrawRules.State memory next, uint256 cardId)
    {
        (next, cardId) = st.support
            .closePanel(
                st.input.playerDeck, st.draw, refreshSlots, uint8(chosenId), st.input.seed, st.lastTxAnchor, uint8(k)
            );
    }

    /// @notice openDeferred: opens thresholds crossed while a panel was open, in order.
    function _openDeferred(State memory st, uint256 tau) private pure {
        while (st.deferred != 0 && !st.panel.open && !st.hasStopPanel) {
            uint256 k = st.deferred;
            st.deferred = st.horses[st.player].cp > k ? k + 1 : 0;
            _openPanel(st, k, tau);
        }
    }

    // ------------------------------------------------------------ motion glue

    function _allFinished(State memory st) private pure returns (bool) {
        for (uint256 h; h < HORSES; ++h) {
            if (!st.horses[h].finished) return false;
        }
        return true;
    }

    /// @notice nextKnownTau; also refreshes the motion caches, the running list and the well owners.
    function _nextKnownTau(State memory st, uint256 tau) private pure returns (uint256 next) {
        PaidRaceMotion.Stretch memory sx = st.stretch;
        sx.wind = st.wind;
        sx.windPlacer = st.windPlacer;
        next = PaidRaceMotion.refresh(st.horses, sx, st.laneLive, st.bombs, tau);
        if (next > MAX_TAU) next = MAX_TAU;
        if (st.wellsDirty) _collectOwners(st);
        uint256 instMin = _instMin(st);
        if (instMin < next) next = instMin;
        if (st.panel.open && st.panel.closeTau < next) next = st.panel.closeTau;
        if (next <= tau) revert PaidRaceMotion.NoProgress();
    }

    /// @dev wellOwners: one entry per active well instance (finished owners have none).
    function _collectOwners(State memory st) private pure {
        PaidRaceMotion.Stretch memory sx = st.stretch;
        uint256 n;
        uint256 count = st.instanceCount;
        for (uint256 i; i < count; ++i) {
            Instance memory inst = st.instances[i];
            if (!inst.active || !inst.well) continue;
            if (n >= PaidRaceMotion.MAX_OWNERS) revert OwnerLimit();
            PaidRaceMotion.setOwner(sx, n++, st.horses[inst.owner]);
        }
        sx.ownerCount = n;
        st.wellsDirty = false;
    }

    /// @notice The bombs each running, non-airborne horse passed in the last step (advance's pending list).
    function _collectPending(State memory st) private pure {
        uint256 n;
        for (uint256 h; h < HORSES; ++h) {
            PaidRaceMotion.Horse memory horse = st.horses[h];
            if (horse.finished || horse.aggAirborne != 0) continue;
            uint256 mask = st.laneLive[horse.lane];
            for (uint256 id; mask != 0; ++id) {
                if (mask & 1 != 0) {
                    PaidRaceMotion.Bomb memory bomb = st.bombs[id];
                    if (bomb.pos > horse.prevPos && bomb.pos <= horse.pos && (!horse.blindedPro || bomb.placer == h)) {
                        st.pending[n++] = h | (id << 8);
                    }
                }
                mask >>= 1;
            }
        }
        st.pendingCount = n;
    }

    /// @notice tauLimit(untilWall) <= tau means the wall is reached; the division truncates like the reference.
    function _tauLimit(State memory st, uint256 tau) private pure returns (bool reached, uint256 limit) {
        int256 span = int256(st.untilWall) - int256(st.mapWall);
        int256 at = int256(st.mapTau) + (st.mapSlow ? span / int256(SLOW_FACTOR) : span);
        if (at <= int256(tau)) return (true, 0);
        return (false, uint256(at));
    }

    // ------------------------------------------------------------ result

    function _buildResult(State memory st, uint256 status, uint256 tau) private pure returns (Result memory r) {
        r.status = status;
        r.tauEnd = tau;
        r.wallEnd = _wallAt(st, tau);
        uint256 unfinishedWall = status == STATUS_COMPLETE ? _wallAt(st, tau) : NEVER;
        for (uint256 h; h < HORSES; ++h) {
            PaidRaceMotion.Horse memory horse = st.horses[h];
            r.finishTime[h] = uint32(horse.finished ? horse.finishTime : UNFINISHED_TAU);
            r.finishWall[h] = uint32(horse.finished ? horse.finishWall : unfinishedWall);
        }
        for (uint256 k; k < 3; ++k) {
            r.acquiredByCheckpoint[k] = uint8(st.records[k].cardId);
        }
        (r.rawOrder, r.settlementOrder, r.rawRank, r.settlementRank, r.versionAnswer) =
            st.support.settle(r.finishTime, uint8(st.player), r.acquiredByCheckpoint);
        if (status == STATUS_PANEL) {
            r.hasPanel = true;
            r.panel = st.stopPanel;
        } else if (st.panel.open) {
            r.hasPanel = true;
            r.panel = _panelView(st, st.panel);
        }
        r.checkpoints = st.records;
        r.eventCount = st.eventCount;
        r.digest = st.digest;
        r.stepCount = st.stretch.steps;
        if (st.logEvents) {
            uint256[] memory meta = st.eventMeta;
            int256[] memory args = st.eventArgs;
            uint256 count = st.eventCount;
            assembly ("memory-safe") {
                mstore(meta, count)
                mstore(args, count)
            }
            r.eventMeta = meta;
            r.eventArgs = args;
        }
    }
}
