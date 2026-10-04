// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../interfaces/IPaidRaceSolver.sol";
import {PaidRaceCardPlan} from "./PaidRaceCardPlan.sol";
import {PaidCardRules} from "./PaidCardRules.sol";
import {PaidDrawRules} from "./PaidDrawRules.sol";
import {PaidProfiles} from "./PaidProfiles.sol";
import {PaidRaceMotion} from "./PaidRaceMotion.sol";
import {PaidRaceCold} from "./PaidRaceCold.sol";
import {PaidSwap} from "./PaidSwap.sol";
import {PonyRules} from "./PonyRules.sol";
import {RaceEntropy} from "./RaceEntropy.sol";

/// @notice Solidity port of the paid ruleset v4 reference solver (src/race/paid/solver.ts). The TS solver is the
/// specification: every handler below mirrors its namesake there, in the same order, and folds the same event
/// digest. Memory only; card parameters come from the generated PaidCardRules table.
/// @dev Deviations are representation only: effect totals per horse are kept incrementally instead of looping over
/// instances, each instance caches its next due time, and the stretch between events runs in PaidRaceMotion. The
/// cold-path derivation, rules, draw transitions and settlement stay modular in PaidRaceCold, in the same contract.
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
    uint256 internal constant REGEN_PER_MS = PaidRaceMotion.REGEN_PER_MS;
    uint256 internal constant BPS = PaidRaceMotion.BPS;
    uint256 internal constant SLOW_FACTOR = 10;
    uint256 internal constant CHOICE_WINDOW_SEC = 20;
    uint256 internal constant RESPAWN_MS = 5_000;
    uint256 internal constant SWAP_EVENT_STRIDE = 256;
    uint256 internal constant MAX_INSTANCES = 96;
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
    uint256 internal constant OFF_RECYCLED = 3;
    uint256 internal constant EV_TRIGGER = 29;
    uint256 internal constant EV_RESOURCE = 30;
    uint256 internal constant EV_GUARD = 31;
    uint256 internal constant EV_TARGET = 32;
    uint256 internal constant EV_EQUIP_REFRESH = 33;
    uint256 internal constant EV_FIXED = 34;

    uint256 internal constant KIND_BUFF = 0;
    uint256 internal constant KIND_EQUIP = 1;
    uint256 internal constant KIND_ABILITY = 2;
    uint256 internal constant KIND_RESPAWN = 3;
    uint256 internal constant KIND_BONUS = 4;
    uint256 internal constant KIND_WATCH = 5;
    uint256 internal constant KIND_FIXED = 6;
    uint256 internal constant KIND_TRAIT = 7;
    uint256 internal constant EV_PONY = 35;

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
    uint256 private constant SIMPLE_BUFF_EFFECTS = (uint256(1) << PaidCardRules.EFFECT_AIRBORNE_SPEED)
        | (uint256(1) << PaidCardRules.EFFECT_SPEED_DEATH) | (uint256(1) << PaidCardRules.EFFECT_DRAW_CUT)
        | (uint256(1) << PaidCardRules.EFFECT_REGEN) | (uint256(1) << PaidCardRules.EFFECT_WIRED);
    uint256 private constant EQUIPMENT_EFFECTS = (uint256(1) << PaidCardRules.EFFECT_ROCKET)
        | (uint256(1) << PaidCardRules.EFFECT_RAINBOW) | (uint256(1) << PaidCardRules.EFFECT_GRAVITY)
        | (uint256(1) << PaidCardRules.EFFECT_WHEEL);

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
        /// @dev Diagnostics without a roster retain the previous rules. Production will always enable this.
        bool ponyAbilities;
        uint8[5] roster;
    }

    /// @notice PaidSolveOptions: stopAtPanel 0 = none; untilWall only when hasUntilWall; logEvents keeps the event list.
    struct Options {
        uint8 stopAtPanel;
        bool hasUntilWall;
        uint256 untilWall;
        bool logEvents;
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
        bool luck;
        bool well;
        bool wheel;
        bytes32 anchor;
        uint256 checkpoint;
        uint256 eventBase;
        uint256 count;
        int256 costDelta;
        int256 fixedDelta;
        bool gated;
        uint256 nextDist;
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
        uint256 adrenaline;
        int256 windBps;
        uint256 wheelDeltaV;
        uint256 autoPanelSec;
        uint256 swapPeriod;
        uint256 swapAttempts;
        uint256 wheelPeriod;
        int256 bonusBps;
    }

    struct CardSource {
        bytes32 anchor;
        uint256 checkpoint;
        uint256 eventBase;
    }

    struct State {
        CoreInput input;
        uint256 player;
        uint256 currentTau;
        uint32[5] coats;
        Params params;
        PaidCardRules.Rule[40] rules;
        PaidRaceMotion.Horse[5] horses;
        PaidRaceMotion.Stretch stretch;
        Instance[96] instances;
        uint256 instanceCount;
        /// @dev Per instance: min(end, next trigger) while active, else NEVER; instMin is their minimum.
        uint256[96] instNext;
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
        uint256[5] ponyWords;
        uint8[5] seenFunctions;
        int256[5] ponyPassive;
    }

    // ------------------------------------------------------------ entry points

    /// @notice solvePaidCore. Stored choices never make it revert (有奖规则 v3): only malformed profiles/decks, options
    /// and the unreachable instance/bomb/event/owner caps do.
    function solve(CoreInput memory input, Options memory opts) internal pure returns (Result memory) {
        (State memory st, uint256 tau, uint256 status) = _run(input, opts);
        return _buildResult(st, status, tau);
    }

    /// @notice Production result uses the same event loop, without constructing diagnostic panels and records.
    function solveRace(CoreInput memory input) internal pure returns (IPaidRaceSolver.RaceResult memory r) {
        // The public solver derives this core through PaidRaceCold; only diagnostics accept arbitrary cores.
        State memory st = _createState(input);
        uint256 tau;
        for (;;) {
            _processProduction(st, tau);
            if (_allFinished(st) || tau >= MAX_TAU) break;
            bool cut;
            (tau, cut) = _advance(st, tau, _nextKnownTau(st, tau));
            st.pendingCount = 0;
            if (cut) _collectPending(st);
        }
        _unusedChoices(st, tau);
        for (uint256 h; h < HORSES; ++h) {
            PaidRaceMotion.Horse memory horse = st.horses[h];
            r.finishTime[h] = uint32(horse.finished ? horse.finishTime : UNFINISHED_TAU);
            r.finishWall[h] = uint32(horse.finished ? horse.finishWall : _wallAt(st, tau));
        }
        for (uint256 k; k < 3; ++k) {
            r.acquired[k] = uint8(st.records[k].cardId);
        }
        (r.rawOrder, r.settlementOrder, r.playerRawRank, r.playerSettlementRank,) =
            PaidRaceCold.settle(r.finishTime, uint8(st.player), r.acquired);
        r.eventCount = uint32(st.eventCount);
        r.digest = st.digest;
    }

    function _run(CoreInput memory input, Options memory opts)
        private
        pure
        returns (State memory st, uint256 tau, uint256 status)
    {
        _validate(input);
        if (opts.stopAtPanel > 3) revert InvalidOptions();
        st = _createState(input);
        st.stopAt = opts.stopAtPanel;
        st.hasUntilWall = opts.hasUntilWall;
        st.untilWall = opts.untilWall;
        st.logEvents = opts.logEvents;
        if (opts.logEvents) st.eventMeta = new uint256[](MAX_EVENTS);
        st.eventArgs = new int256[](MAX_EVENTS);
        status = STATUS_COMPLETE;
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
            (tau, cut) = _advance(st, tau, horizon);
            st.pendingCount = 0;
            if (cut) _collectPending(st);
        }
        if (status == STATUS_COMPLETE) _unusedChoices(st, tau);
    }

    function _unusedChoices(State memory st, uint256 tau) private pure {
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

    function _advance(State memory st, uint256 tau, uint256 horizon) private pure returns (uint256 t, bool cut) {
        uint256 scratch;
        assembly ("memory-safe") { scratch := mload(0x40) }
        (t, cut) = PaidRaceMotion.advance(st.stretch, tau, horizon);
        assembly ("memory-safe") { mstore(0x40, scratch) }
    }

    // ------------------------------------------------------------ setup

    function _validate(CoreInput memory input) private pure {
        uint256 player = input.playerHorseId;
        if (player >= HORSES) revert InvalidHorse();
        for (uint256 h; h < HORSES; ++h) {
            PaidProfiles.Profile memory p = input.profiles[h];
            if (p.cap < p.base || p.cap > MAX_PROFILE_CAP) revert InvalidProfiles();
        }
        // Card ids 1..40, no repeats within a deck (bit id of `seen`).
        uint256 seen;
        for (uint256 i; i < 14; ++i) {
            uint256 id = input.playerDeck[i];
            if (id == 0 || id > PaidCardRules.CARD_COUNT || (seen >> id) & 1 != 0) revert InvalidDeck();
            seen |= uint256(1) << id;
        }
        for (uint256 h; h < HORSES; ++h) {
            if (h == player) continue;
            uint256 cpuSeen;
            for (uint256 i; i < 3; ++i) {
                uint256 id = input.cpuDecks[h][i];
                if (id == 0 || id > PaidCardRules.CARD_COUNT || (cpuSeen >> id) & 1 != 0) revert InvalidCpuDecks();
                cpuSeen |= uint256(1) << id;
            }
        }
    }

    function _createState(CoreInput memory input) private pure returns (State memory st) {
        st.input = input;
        st.player = input.playerHorseId;
        if (input.ponyAbilities) st.ponyWords = PaidRaceCold.ponyWords(input.roster);
        _loadParams(st);
        PaidRaceMotion.initHorses(st.horses, input.profiles, st.ponyWords, UNFINISHED_TAU);
        for (uint256 i; i < MAX_INSTANCES; ++i) {
            st.instNext[i] = NEVER;
        }
        st.instMin = NEVER;
        st.draw = PaidDrawRules.initial();
    }

    function _rule(State memory st, uint8 id) private pure returns (PaidCardRules.Rule memory) {
        PaidCardRules.Rule memory r = st.rules[id - 1];
        if (r.id == 0) {
            (uint256 hi, uint256 lo) = PaidRaceCold.cardRuleWords(id);
            r = PaidCardRules.decode(hi, lo);
            st.rules[id - 1] = r;
        }
        return r;
    }

    function _loadParams(State memory st) private pure {
        uint256[11] memory words = PaidRaceCold.raceParams();
        Params memory p = st.params;
        assembly ("memory-safe") { mcopy(p, words, 0x100) }
        st.stretch.radius = words[8];
        st.stretch.strength = words[9];
        st.stretch.overlap = int256(words[10]);
    }

    // ------------------------------------------------------------ bookkeeping

    /// @dev emit(): digest = keccak256(abi.encode(bytes32 digest, uint8 code, uint32 tau, uint8 horse, int256 arg)).
    function _log(State memory st, uint256 code, uint256 tau, uint256 horse, int256 arg) private pure {
        uint256 count = st.eventCount;
        if (count >= MAX_EVENTS) revert EventLimit();
        bytes32 digest = st.digest;
        // code <= 35, tau <= 600000 and horse <= 4 already fit uint8/uint32/uint8, so the words equal abi.encode.
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
            // Both diagnostic arrays have MAX_EVENTS entries, and count was checked above.
            uint256[] memory meta = st.eventMeta;
            int256[] memory args = st.eventArgs;
            assembly ("memory-safe") {
                let offset := add(0x20, shl(5, count))
                mstore(add(meta, offset), or(code, or(shl(8, tau), shl(40, horse))))
                mstore(add(args, offset), arg)
            }
        }
        unchecked {
            st.eventCount = count + 1; // count < MAX_EVENTS
        }
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
        unchecked {
            id = index + 1; // index < MAX_INSTANCES
        }
        st.instanceCount = id;
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
        horse.aggCost += inst.costDelta;
        horse.fixedK += inst.fixedDelta;
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
        horse.aggCost -= inst.costDelta;
        horse.fixedK -= inst.fixedDelta;
        inst.fixedDelta = 0;
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
        if (inst.kind == KIND_EQUIP && inst.wheel) {
            uint256 at = inst.start + st.params.wheelPeriod * (inst.count + 1);
            return at < inst.end ? at : NEVER;
        }
        if (inst.kind == KIND_WATCH && st.currentTau < inst.end) {
            return _watchTrigger(st, inst);
        }
        return NEVER;
    }

    /// @dev Preserve the canonical uint8/uint32 widths and packed state while reading permanent cached rules.
    function _watchTrigger(State memory st, Instance memory inst) private pure returns (uint256) {
        uint8 card = uint8(inst.cardId);
        uint8 count = uint8(inst.count);
        uint32 start = uint32(inst.start);
        uint32 now_ = uint32(st.currentTau);
        PaidCardRules.Rule memory r = _rule(st, card);
        if (card == 23 && count == 0) return uint256(start) + r.periodMs;
        PaidRaceMotion.Horse memory h = st.horses[inst.owner];
        if (card == 24) {
            if (h.s <= r.thresholdMicro) return now_;
            uint256 cost = _cost(h);
            uint256 regen = REGEN_PER_MS * (BPS + h.aggRegen) / BPS;
            // Preserve the old packed ABI test, including any bits in dist/nextDist above bit 127.
            uint256 state_ = h.dist | inst.nextDist << 64 | uint256(h.exhausted || h.overcap ? 1 : 0) << 128;
            if (state_ >> 128 == 0 && cost > regen) {
                uint256 d = cost - regen;
                return uint256(now_) + (h.s - r.thresholdMicro + d - 1) / d;
            }
        }
        if (card == 40 && count < r.count) {
            uint256 state_ = h.dist | inst.nextDist << 64 | uint256(h.exhausted || h.overcap ? 1 : 0) << 128;
            if (uint64(state_) >= uint64(state_ >> 64)) return now_;
        }
        return NEVER;
    }

    function _instMin(State memory st) private pure returns (uint256 m) {
        if (!st.instDirty) return st.instMin;
        uint256[96] memory next = st.instNext;
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
        (uint256 cls1, uint256 cls2, uint256 cls5) = PaidRaceMotion.horseDues(st.horses);
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
        st.currentTau = tau;
        for (;;) {
            _syncNew(st);
            (uint256 cls, uint256 key) = _findDue(st, tau);
            if (cls == CLS_NONE) return STATUS_RUNNING;
            if (st.hasUntilWall) {
                uint256 stamp = cls == 6 ? st.panel.closeWall : _wallAt(st, tau);
                if (stamp > st.untilWall) return STATUS_WALL;
            }
            _applyDue(st, cls, key, tau);
            if (st.hasStopPanel) {
                Record memory rec = st.records[st.stopAt - 1];
                if (rec.mode == MODE_CUT) {
                    PanelView memory v = st.stopPanel;
                    v.checkpoint = st.stopAt;
                    v.mode = MODE_CUT;
                    v.openTau = rec.openTau;
                    v.openWall = rec.openWall;
                    v.draw = _copyDraw(st.draw);
                } else {
                    st.stopPanel = _panelView(st, st.panel);
                }
                return STATUS_PANEL;
            }
        }
    }

    /// @dev The same ordered due scan and handlers; only diagnostic stop conditions are omitted here.
    function _processProduction(State memory st, uint256 tau) private pure {
        st.currentTau = tau;
        for (;;) {
            _syncNew(st);
            (uint256 cls, uint256 key) = _findDue(st, tau);
            if (cls == CLS_NONE) return;
            _applyDue(st, cls, key, tau);
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

    function _expire(State memory st, uint256 index, uint256 tau) internal pure {
        Instance memory inst = st.instances[index];
        uint256 id = index + 1;
        _endInstance(st, inst, id);
        if (inst.kind == KIND_EQUIP) {
            _log(st, EV_EQUIP_OFF, tau, inst.owner, int256(id << 2 | OFF_EXPIRED));
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
        } else if (inst.kind == KIND_WATCH) {
            PaidCardRules.Rule memory r = _rule(st, uint8(inst.cardId));
            _triggerLog(st, inst, tau);
            if (inst.cardId == 23) {
                _setBuff(st, inst, int256(uint256(r.bonusBps)), 0);
            } else if (inst.cardId == 24) {
                _endInstance(st, inst, index + 1);
                uint256 before = st.horses[inst.owner].s;
                _recover(st, inst.owner, r.staminaMicro, tau);
                if (
                    inst.start == tau && st.horses[inst.owner].s > before
                        && uint8(st.ponyWords[inst.owner] >> 128) == PonyRules.FOOD
                ) {
                    _recover(st, inst.owner, uint32(st.ponyWords[inst.owner]), tau);
                    _ponyTrigger(st, inst.owner, 24, tau);
                }
            } else if (inst.cardId == 40) {
                inst.nextDist += r.radiusMicro;
                st.horses[inst.owner].fixedK += r.triggerFixedSpeed;
                _log(st, EV_FIXED, tau, inst.owner, r.triggerFixedSpeed);
            }
            _touch(st, inst, index);
        } else {
            inst.count += 1;
            _touch(st, inst, index);
            st.horses[inst.owner].fixedK += int256(st.params.wheelDeltaV);
            _log(st, EV_WHEEL_BURST, tau, inst.owner, int256(inst.count));
        }
    }

    /// @dev Re-derives an instance's due time after its trigger counter moved.
    function _touch(State memory st, Instance memory inst, uint256 index) private pure {
        st.instNext[index] = _instanceNext(st, inst);
        st.instDirty = true;
    }

    function _kill(State memory st, uint256 h, uint256 tau) internal pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        if (horse.finished) return;
        if (_respawning(horse)) {
            _log(st, EV_DEATH_IMMUNE, tau, h, 0);
            return;
        }
        uint256 count = st.instanceCount;
        for (uint256 i; i < count; ++i) {
            Instance memory inst = st.instances[i];
            if (inst.active && inst.owner == h && inst.kind == KIND_WATCH && inst.cardId == 37) {
                _endInstance(st, inst, i + 1);
                _log(st, EV_GUARD, tau, h, int256(i + 1));
                return;
            }
        }
        for (uint256 i; i < count; ++i) {
            Instance memory inst = st.instances[i];
            if (inst.active && inst.owner == h && inst.kind == KIND_FIXED) _endInstance(st, inst, i + 1);
        }
        horse.b = 0;
        horse.fixedK = 0;
        horse.atCap = false;
        (Instance memory respawn, uint256 id) = _addInstance(st, tau, h, 0, KIND_RESPAWN, RESPAWN_MS);
        _activate(st, respawn, id);
        _log(st, EV_DEATH, tau, h, int256(id));
        for (uint256 i; i < count; ++i) {
            Instance memory inst = st.instances[i];
            if (!inst.active || inst.owner != h || inst.kind != KIND_WATCH || inst.cardId != 38 || tau >= inst.end) {
                continue;
            }
            _endInstance(st, inst, i + 1);
            _triggerLog(st, inst, tau);
            PaidCardRules.Rule memory r = _rule(st, 38);
            (Instance memory burst, uint256 bid) = _addInstance(st, tau, h, 38, KIND_FIXED, r.triggerDurationMs);
            burst.fixedDelta = r.fixedSpeed;
            _activate(st, burst, bid);
            _log(st, EV_FIXED, tau, h, r.fixedSpeed);
            break;
        }
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
        int256 arg = int256(attempt << 3 | target);
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
        _log(st, EV_PANEL_CLOSE, tau, h, int256(panel.k << 4 | CLOSE_FINISHED));
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
        PaidCardRules.Rule memory rule = _rule(st, uint8(cardId));
        uint256 staminaBefore = horse.s;
        _log(st, EV_CARD, tau, h, int256(cardId));
        uint256 lootMs;
        uint8 effect = rule.effect;
        if (SIMPLE_BUFF_EFFECTS & (uint256(1) << effect) != 0) {
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
        } else if (EQUIPMENT_EFFECTS & (uint256(1) << effect) != 0) {
            uint256 duration = rule.durationMs;
            uint256 word = st.ponyWords[h];
            // Table duration is uint32 and the extension factor uint16, so the product is below 2^48.
            if (uint8(word >> 128) == PonyRules.LONG_EQUIPMENT) {
                unchecked {
                    duration = duration * uint16(word >> 64) / BPS;
                }
            }
            _equip(st, h, rule, tau, duration);
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
            horse.fixedK += int256(rule.fixedSpeed);
            if (effect == PaidCardRules.EFFECT_BLIND_FIXED) horse.blindedPro = true;
        } else if (effect == PaidCardRules.EFFECT_COAT) {
            st.coats[h] = rule.coatRgb;
        } else if (effect >= PaidCardRules.EFFECT_PAY) {
            lootMs = _newCard(st, h, rule, tau);
        }
        if (horse.bonus) _buff(st, h, cardId, tau, _bonusDuration(rule, lootMs), st.params.bonusBps, KIND_BONUS);
        if (effect == PaidCardRules.EFFECT_DRAW_AUTO) horse.bonus = true;
        _onPonyCard(st, h, cardId, staminaBefore, lootMs, tau);
    }

    function _onPonyCard(State memory st, uint256 h, uint256 card, uint256 before, uint256 lootMs, uint256 tau)
        private
        pure
    {
        // h comes from the five-horse due loop or the validated player slot; memory arrays use one word per item.
        uint256[5] memory words = st.ponyWords;
        uint8[5] memory seen = st.seenFunctions;
        uint256 word;
        uint256 prior;
        assembly ("memory-safe") {
            word := mload(add(words, shl(5, h)))
            prior := mload(add(seen, shl(5, h)))
        }
        if (word == 0) return;
        uint256 context = prior | lootMs << 8 | (st.horses[h].s > before ? 1 << 40 : 0);
        uint256 action = _ponyAcquisition(st, word, uint8(card), context);
        assembly ("memory-safe") { mstore(add(seen, shl(5, h)), and(shr(56, action), 0xff)) }
        if (uint8(action >> 48) != 0) _ponySpeed(st, h, card, tau, action);
        uint256 food = uint32(action >> 64);
        if (food != 0) {
            _recover(st, h, food, tau);
            _ponyTrigger(st, h, card, tau);
        }
    }

    /// @dev Context: seen:u8, lootMs:u32, gained:u1. Action: percent:u16, duration:u32, kind:u8, seen:u8, food:u32.
    function _ponyAcquisition(State memory st, uint256 word, uint8 card, uint256 context)
        private
        pure
        returns (uint256 action)
    {
        uint8 ability = uint8(word >> 128);
        uint8 bit = uint8(1 << PaidCardRules.mainFunction(card));
        uint8 seen = uint8(context);
        action = uint256(seen | bit) << 56;
        PaidCardRules.Rule memory r = _rule(st, card);
        uint256 duration = uint32(word >> 80);
        uint256 kind = KIND_TRAIT;
        bool grant;
        if (ability == PonyRules.RARE_SPECIALIST && r.rare) {
            grant = true;
            kind = KIND_BONUS;
            if (r.bonusMode == 0) duration = r.durationMs;
            else if (r.bonusMode == 1) duration = NEVER;
            else if (r.bonusMode == 3 && uint32(context >> 8) > 0) duration = uint32(context >> 8);
            else duration = PaidCardRules.BONUS_DEFAULT_MS;
        } else if (ability == PonyRules.DIVERSE) {
            grant = seen & bit == 0;
        } else if (ability == PonyRules.REPEAT) {
            grant = seen & bit != 0;
        }
        if (grant) action |= uint16(word >> 112) | duration << 16 | kind << 48;
        if (ability == PonyRules.FOOD && bit == 1 << PaidCardRules.MAIN_SUPPLY && context & (1 << 40) != 0) {
            action |= uint256(uint32(word)) << 64;
        }
    }

    function _cost(PaidRaceMotion.Horse memory h) private pure returns (uint256) {
        // At most 96 deltas from 16-bit table parameters plus one uint16 role delta; scaled costs fit far below uint256.
        unchecked {
            int256 factor = int256(BPS) + h.aggCost;
            if (factor < int256(uint256(PaidCardRules.MIN_COST_FACTOR_BPS))) {
                factor = int256(uint256(PaidCardRules.MIN_COST_FACTOR_BPS));
            }
            return COST_PER_MS * uint256(factor) / BPS;
        }
    }

    function _setBuff(State memory st, Instance memory inst, int256 p, uint256 regen) private pure {
        PaidRaceMotion.Horse memory h = st.horses[inst.owner];
        h.aggP += p - inst.pBps;
        h.aggRegen = h.aggRegen - inst.regenBps + regen;
        inst.pBps = p;
        inst.regenBps = regen;
    }

    function _syncNew(State memory st) private pure {
        // Zeroes every horse's nextDist and re-applies the roster's passive percentage in one pass.
        PaidRaceMotion.syncPonyPassives(st.horses, st.ponyWords, st.ponyPassive);
        for (uint256 i; i < st.instanceCount; ++i) {
            Instance memory inst = st.instances[i];
            if (!inst.active) continue;
            PaidRaceMotion.Horse memory h = st.horses[inst.owner];
            if (inst.gated) {
                (int256 p, uint256 regen) = _gatedModifiers(st, inst, h);
                _setBuff(st, inst, p, regen);
            }
            if (inst.kind == KIND_WATCH) {
                if (inst.cardId == 40 && inst.count < _rule(st, 40).count) {
                    if (h.nextDist == 0 || inst.nextDist < h.nextDist) h.nextDist = inst.nextDist;
                }
                _touch(st, inst, i);
            }
        }
    }

    function _gatedModifiers(State memory st, Instance memory inst, PaidRaceMotion.Horse memory h)
        private
        pure
        returns (int256 p, uint256 regen)
    {
        uint8 card = uint8(inst.cardId);
        PaidCardRules.Rule memory r = _rule(st, card);
        p = r.pBps;
        if (card == 26 && h.aggWired != 0) {
            p += int256(uint256(r.bonusBps));
        } else if (card == 27 && h.aggAirborne != 0) {
            p += int256(uint256(r.bonusBps));
        } else if (card == 28 && h.aggAirborne != 0) {
            p = 0;
        } else if (card == 29) {
            uint32 coat = st.coats[inst.owner];
            if (coat == _rule(st, 20).coatRgb) {
                p = 0;
                regen = r.regenBonusBps;
            } else if (coat != _rule(st, 19).coatRgb) {
                p = r.fallbackBps;
            }
        } else if (card == 33 && (h.equipTorso != 0 || h.equipTail != 0 || h.equipHooves != 0)) {
            p = r.fallbackBps;
        }
    }

    function _buff(State memory st, uint256 h, uint256 card, uint256 tau, uint256 duration, int256 p, uint256 kind)
        private
        pure
    {
        (Instance memory inst, uint256 id) = _addInstance(st, tau, h, card, kind, duration);
        inst.pBps = p;
        _activate(st, inst, id);
    }

    function _recover(State memory st, uint256 h, uint256 amount, uint256 tau) private pure {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        // An over-cap horse gains zero; otherwise s + gain is bounded by STAMINA_CAPACITY.
        unchecked {
            uint256 room = horse.s < STAMINA_CAPACITY ? STAMINA_CAPACITY - horse.s : 0;
            uint256 gain = amount < room ? amount : room;
            horse.s += gain;
            _log(st, EV_RESOURCE, tau, h, int256(gain));
        }
    }

    function _triggerLog(State memory st, Instance memory inst, uint256 tau) private pure {
        inst.count += 1;
        _log(st, EV_TRIGGER, tau, inst.owner, int256(inst.cardId << 8 | inst.count));
    }

    function _onEquipment(State memory st, uint256 h, uint256 tau) private pure {
        uint256 n = st.instanceCount;
        for (uint256 i; i < n; ++i) {
            Instance memory inst = st.instances[i];
            if (!inst.active || inst.owner != h || inst.kind != KIND_WATCH || inst.cardId != 31) continue;
            PaidCardRules.Rule memory r = _rule(st, 31);
            _triggerLog(st, inst, tau);
            _buff(st, h, 31, tau, r.triggerDurationMs, int256(uint256(r.bonusBps)), KIND_BUFF);
        }
    }

    function _onForfeit(State memory st, uint256 tau) private pure {
        uint256 word = st.ponyWords[st.player];
        if (uint8(word >> 128) == PonyRules.FORFEIT) {
            _ponySpeed(
                st, st.player, 0, tau, uint16(word >> 112) | uint256(uint32(word >> 80)) << 16 | KIND_TRAIT << 48
            );
        }
        for (uint256 i; i < st.instanceCount; ++i) {
            Instance memory inst = st.instances[i];
            if (
                !inst.active || inst.owner != st.player || inst.kind != KIND_WATCH || inst.cardId != 39
                    || inst.start >= tau
            ) continue;
            PaidCardRules.Rule memory r = _rule(st, 39);
            _endInstance(st, inst, i + 1);
            _triggerLog(st, inst, tau);
            _recover(st, st.player, r.staminaMicro, tau);
            _buff(st, st.player, 39, tau, r.triggerDurationMs, int256(uint256(r.bonusBps)), KIND_BUFF);
            break;
        }
    }

    function _newCard(State memory st, uint256 h, PaidCardRules.Rule memory r, uint256 tau)
        private
        pure
        returns (uint256 lootMs)
    {
        uint256[5] memory horses;
        for (uint256 id; id < HORSES; ++id) {
            PaidRaceMotion.Horse memory x = st.horses[id];
            horses[id] = x.pos | x.dist << 64 | x.s << 128 | uint256(x.finished ? 1 : 0) << 192
                | uint256(x.blindedPro ? 1 : 0) << 193;
        }
        uint256[3] memory equipment;
        for (uint256 slot; slot < 3; ++slot) {
            uint256 id = st.horses[h].equipOf(slot);
            if (id != 0) equipment[slot] = id | st.instances[id - 1].cardId << 8 | st.instances[id - 1].end << 16;
        }
        uint256[] memory actions;
        (actions, lootMs) = PaidRaceCold.newCardPlan(r.id, uint8(h), horses, equipment);
        for (uint256 i; i < actions.length; ++i) {
            uint256 w = actions[i];
            PaidRaceCardPlan.Action memory a = PaidRaceCardPlan.Action(
                uint8(w), uint8(w >> 8), uint32(w >> 16), int64(uint64(w >> 48)), uint64(w >> 112)
            );
            if (a.kind <= PaidRaceCardPlan.GATE) {
                _activateAction(st, r, a, tau);
            } else if (a.kind == PaidRaceCardPlan.PAY) {
                st.horses[h].s -= uint256(a.value);
                _log(st, EV_RESOURCE, tau, h, -a.value);
            } else if (a.kind == PaidRaceCardPlan.RECOVER) {
                _recover(st, a.horse, uint256(a.value), tau);
            } else if (a.kind == PaidRaceCardPlan.RECYCLE) {
                uint256 id = uint256(a.value);
                _endInstance(st, st.instances[id - 1], id);
                _log(st, EV_EQUIP_OFF, tau, h, int256(id << 2 | OFF_RECYCLED));
            } else if (a.kind == PaidRaceCardPlan.RENEW) {
                uint256 id = uint256(a.value);
                Instance memory inst = st.instances[id - 1];
                inst.end = tau + a.duration;
                _touch(st, inst, id - 1);
                _log(st, EV_EQUIP_REFRESH, tau, h, int256(id));
            } else if (a.kind == PaidRaceCardPlan.FIXED) {
                st.horses[h].fixedK += a.value;
                _log(st, EV_FIXED, tau, h, a.value);
            } else if (a.kind == PaidRaceCardPlan.TARGET) {
                _log(st, EV_TARGET, tau, h, a.value);
            } else if (a.kind == PaidRaceCardPlan.TINKER) {
                _onEquipment(st, h, tau);
            }
        }
    }

    function _activateAction(
        State memory st,
        PaidCardRules.Rule memory r,
        PaidRaceCardPlan.Action memory a,
        uint256 tau
    ) private pure {
        bool watch = a.kind == PaidRaceCardPlan.WATCH;
        bool gate = a.kind == PaidRaceCardPlan.GATE;
        (Instance memory inst, uint256 id) =
            _addInstance(st, tau, a.horse, r.id, watch ? KIND_WATCH : KIND_BUFF, a.duration);
        inst.gated = gate && r.id != 25;
        inst.pBps = gate ? (r.id == 25 ? r.pBps : int256(0)) : (watch && r.id != 23 ? int256(0) : a.value);
        if (gate) inst.costDelta = a.value;
        if (watch && r.id == 23) inst.regenBps = a.aux;
        if (watch && r.id == 40) inst.nextDist = a.aux;
        _activate(st, inst, id);
    }

    /// @notice bonusDurationMs: C-04 bonus length (NEVER = permanent); lootMs is the stolen equipment's duration.
    function _bonusDuration(PaidCardRules.Rule memory rule, uint256 lootMs) private pure returns (uint256) {
        if (rule.bonusMode == 0) return rule.durationMs;
        if (rule.bonusMode == 1) return NEVER;
        if (rule.bonusMode == 3 && lootMs > 0) return lootMs;
        return PaidCardRules.BONUS_DEFAULT_MS;
    }

    /// @notice equip: replaces the slot's instance and returns the new instance's full duration.
    function _equip(State memory st, uint256 h, PaidCardRules.Rule memory rule, uint256 tau, uint256 duration)
        private
        pure
        returns (uint256)
    {
        PaidRaceMotion.Horse memory horse = st.horses[h];
        uint256 slot = rule.slot;
        uint256 oldId = horse.equipOf(slot);
        if (oldId != 0) {
            _endInstance(st, st.instances[oldId - 1], oldId);
            _log(st, EV_EQUIP_OFF, tau, h, int256(oldId << 2 | OFF_REPLACED));
        }
        (Instance memory inst, uint256 id) = _addInstance(st, tau, h, rule.id, KIND_EQUIP, duration);
        inst.slot = slot;
        uint8 effect = rule.effect;
        inst.pBps = rule.pBps;
        if (effect == PaidCardRules.EFFECT_ROCKET) {
            inst.costDelta = int256(uint256(rule.costMultiplierBps)) - int256(BPS);
        }
        inst.well = effect == PaidCardRules.EFFECT_GRAVITY;
        inst.wheel = effect == PaidCardRules.EFFECT_WHEEL;
        inst.airborne = inst.wheel;
        _activate(st, inst, id);
        horse.setEquip(slot, id);
        _log(st, EV_EQUIP_ON, tau, h, int256(id));
        _onEquipment(st, h, tau);
        return duration;
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
            _log(st, EV_BOMB_PLACE, tau, h, int256(placer.pos << 3 | lane));
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
        _log(st, EV_EQUIP_OFF, tau, loot.owner, int256(lootId << 2 | OFF_STOLEN));
        PaidCardRules.Rule memory rule = _rule(st, uint8(loot.cardId));
        return _equip(st, h, rule, tau, st.input.ponyAbilities ? loot.end - tau : rule.durationMs);
    }

    function _ponyTrigger(State memory st, uint256 h, uint256 card, uint256 tau) private pure {
        _log(st, EV_PONY, tau, h, int256(uint256(st.input.roster[h]) << 16 | card << 8 | 1));
    }

    function _ponySpeed(State memory st, uint256 h, uint256 card, uint256 tau, uint256 action) private pure {
        _buff(st, h, card, tau, uint32(action >> 16), int256(uint256(uint16(action))), uint8(action >> 48));
        _ponyTrigger(st, h, card, tau);
    }

    // ------------------------------------------------------------ panels

    function _candidatesAt(State memory st) private pure returns (uint8[3] memory offer) {
        uint256 cursor = st.draw.cursor;
        uint8[14] memory deck = st.input.playerDeck;
        // Only three panels exist, so their opening cursor is 0/3/6; each memory uint8 occupies a word.
        assembly ("memory-safe") { mcopy(offer, add(deck, shl(5, cursor)), 0x60) }
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
        _log(st, EV_CHOICE_INVALID, tau, st.player, int256(k << 4 | reason));
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
            if (st.stopAt == k) st.hasStopPanel = true;
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
                invalid = PaidRaceCold.classifyChoice(st.input.playerDeck, st.draw, slot.refreshSlots, slot.cardId);
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
        if (st.stopAt == k) st.hasStopPanel = true;
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
        _log(st, EV_PANEL_CLOSE, tau, st.player, int256(k << 4 | code));
        if (cardId != 0) _applyCard(st, st.player, cardId, src, tau);
        if (reason == REASON_FORFEIT_TX) _onForfeit(st, tau);
        _openDeferred(st, tau);
    }

    /// @dev applyPaidChoice / resolvePaidAutomaticChoice, run in PaidRaceCold.
    function _drawTransition(State memory st, uint8[] memory refreshSlots, uint256 chosenId, uint256 k)
        private
        pure
        returns (PaidDrawRules.State memory next, uint256 cardId)
    {
        (next, cardId) = PaidRaceCold.closePanel(
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
        uint256 scratch;
        assembly ("memory-safe") { scratch := mload(0x40) }
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
        assembly ("memory-safe") { mstore(0x40, scratch) }
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
            PaidRaceCold.settle(r.finishTime, uint8(st.player), r.acquiredByCheckpoint);
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
