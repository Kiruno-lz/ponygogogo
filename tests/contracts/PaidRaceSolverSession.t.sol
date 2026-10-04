// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {LegacyCoreSolverProbe} from "./LegacyCoreSolverProbe.sol";
import {PonyGame} from "../../contracts/PonyGame.sol";
import {PonyVault} from "../../contracts/PonyVault.sol";
import {PonyRewards} from "../../contracts/PonyRewards.sol";
import {RacePayout} from "../../contracts/libraries/RacePayout.sol";
import {Eip2935, PonyVm, VmLog} from "./PonyGameBase.sol";
import {PaidRaceVectorBase} from "./PaidRaceVectorBase.sol";

/// @notice Archived v4 accounting replay with the legacy core adapter: PonyGame + PonyVault replay a vector's session (open, its stored
/// chooseCard transactions at the vector's seconds, settle) and emit exactly the vector's result, acquired cards and
/// payout — including choices the settlement solve ignores (有奖规则 v3), which chooseCard accepted without judging.
/// @dev The vector's seed replaces the one PonyGame derived, and the open and choice blocks get the vector's anchors
/// as their hashes (BLOCKHASH and EIP-2935), so the on-chain RaceInput equals the vector's.
contract PaidRaceSolverSessionTest is PaidRaceVectorBase {
    PonyVm internal constant chain = PonyVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    address internal constant PLAYER = address(0xA11CE);
    uint256 internal constant START_BLOCK = 1_000;
    uint256 internal constant START_TIME = 1_750_000_000;
    uint256 internal constant SESSIONS_SLOT = 6;
    uint256 internal constant SEED_OFFSET = 2;

    LegacyCoreSolverProbe internal solver;
    PonyGame internal game;
    PonyVault internal vault;
    PonyRewards internal rewards;

    function setUp() public {
        chain.roll(START_BLOCK);
        chain.warp(START_TIME);
        chain.etch(Eip2935.HISTORY, Eip2935.RUNTIME);
        solver = new LegacyCoreSolverProbe();
        rewards = new PonyRewards(address(this));
        game = new PonyGame(address(this), solver, rewards);
        rewards.setGame(address(game), true);
        vault = new PonyVault(address(game), address(this));
        game.bindVault(vault);
        chain.deal(address(this), 100 ether);
        vault.fundHouse{value: 100 ether}();
        chain.deal(PLAYER, 30 ether);
        game.setEntryPaused(false);
    }

    /// @dev Three real picks: a gravity well, the wheel and a bomb (rank 5).
    function testReplayDerived1ThroughPonyGame() public {
        _replay("derived-1");
    }

    /// @dev Rank 1: C-05 at checkpoint 1, then a refreshed slot at checkpoint 2 takes C-03 (checkpoint 3 is cut).
    function testReplayDerived61ThroughPonyGame() public {
        _replay("derived-61");
    }

    /// @dev Stored but ignored: a refresh without credit (cp1) and a card not offered (cp2); cp3 takes effect.
    function testReplayFuzzDerived28ThroughPonyGame() public {
        _replay("fuzz-derived-28");
    }

    /// @dev Stored but ignored: an early second (cp2) and a refresh without credit (cp3) after a valid cp1 pick.
    function testReplayFuzzDerived52ThroughPonyGame() public {
        _replay("fuzz-derived-52");
    }

    function _replay(string memory name) internal {
        string memory json = _case(name);
        uint256 index = _index(name);
        PaidRaceEngine.CoreInput memory core = _input(json);
        uint8 tier = uint8(index % 4 + 1);
        uint256 stake = game.stakeForTier(tier);

        chain.prank(PLAYER);
        bytes32 sessionId = game.openSession{value: stake}(core.playerHorseId, stake, [uint8(0), 1, 2, 3, 4]);
        uint256 t0 = chain.getBlockTimestamp();
        uint256 openBlock = chain.getBlockNumber();
        _injectSeed(sessionId, core.seed);
        _setHash(openBlock, core.openAnchor);
        uint256 availableAfterLock = PLAYER.balance;

        uint256 lastTxSec = _chooseAll(name, sessionId, core, openBlock, t0);
        chain.roll(openBlock + 40);
        _warpToSettle(json, sessionId, t0, core.playerHorseId, lastTxSec);

        IPaidRaceSolver.RaceInput memory onChain = game.raceInput(sessionId);
        require(keccak256(abi.encode(onChain.choices)) == keccak256(abi.encode(core.choices)), "on-chain choices");
        require(onChain.openAnchor == core.openAnchor && onChain.seed == core.seed, "on-chain anchors");
        _settle(name, json, sessionId, stake, availableAfterLock);
    }

    /// @dev One second before the player's finishWall settlement must fail; then warps to the first second it may
    /// (never before the last choice).
    function _warpToSettle(string memory json, bytes32 sessionId, uint256 t0, uint8 horse, uint256 lastTxSec) internal {
        uint256 settleSec = (vm.parseJsonUint(json, _key(".expected.finishWall", horse, "")) + 999) / 1000;
        if (settleSec > lastTxSec + 1) {
            chain.warp(t0 + settleSec - 1);
            (bool early,) = address(game).call(abi.encodeCall(PonyGame.settleSession, (sessionId)));
            require(!early, "settled before the player's finishWall");
        }
        chain.warp(t0 + (settleSec > lastTxSec ? settleSec : lastTxSec));
    }

    function _settle(string memory name, string memory json, bytes32 sessionId, uint256 stake, uint256 before)
        internal
    {
        chain.recordLogs();
        uint256 settleGas = gasleft();
        uint256 payout = game.settleSession(sessionId);
        settleGas -= gasleft();
        emit log_named_uint(string.concat(name, " settleSession gas"), settleGas);
        _requireSettled(json, sessionId, payout, stake);
        require(PLAYER.balance == before + payout, "payout sent to the player");
        require(game.sessionOf(PLAYER) == bytes32(0), "session closed");
    }

    event log_named_uint(string key, uint256 val);

    /// @dev Sends every stored choice of the vector at its second, ten blocks apart; returns the last txSec.
    function _chooseAll(
        string memory name,
        bytes32 sessionId,
        PaidRaceEngine.CoreInput memory core,
        uint256 openBlock,
        uint256 t0
    ) internal returns (uint256 lastTxSec) {
        for (uint8 k = 1; k <= 3; ++k) {
            IPaidRaceSolver.ChoiceInput memory choice = core.choices[k - 1];
            if (!choice.present) continue;
            require(choice.txSec >= lastTxSec, "vector choices must be in time order");
            lastTxSec = choice.txSec;
            chain.roll(openBlock + 10 * k);
            chain.warp(t0 + choice.txSec);
            uint256 chooseGas = gasleft();
            chain.prank(PLAYER);
            game.chooseCard(sessionId, k, choice.cardId, choice.refreshSlots);
            chooseGas -= gasleft();
            emit log_named_uint(string.concat(name, " chooseCard cp", _itoa(k), " gas"), chooseGas);
            _setHash(chain.getBlockNumber(), choice.anchor);
            require(game.getSession(sessionId).choices[k - 1].txSec == choice.txSec, "stored txSec");
        }
    }

    struct Settled {
        uint32[5] finishTime;
        uint8[5] rawOrder;
        uint8[5] settlementOrder;
        uint8 rank;
        uint256 payout;
        bytes32 digest;
        uint8[3] acquired;
    }

    function _requireSettled(string memory json, bytes32 sessionId, uint256 payout, uint256 stake) internal {
        VmLog[] memory logs = chain.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(game) || logs[i].topics[0] != PonyGame.SessionSettled.selector) continue;
            require(logs[i].topics[1] == sessionId, "settled session id");
            Settled memory e;
            (e.finishTime, e.rawOrder, e.settlementOrder, e.rank, e.payout, e.digest, e.acquired) =
                abi.decode(logs[i].data, (uint32[5], uint8[5], uint8[5], uint8, uint256, bytes32, uint8[3]));
            _requireVector(json, e);
            uint256 expectedPayout = RacePayout.gross(stake, game.payoutMultipliers()[e.rank - 1]);
            require(e.payout == expectedPayout && payout == expectedPayout, "payout");
            found = true;
        }
        require(found, "SessionSettled not emitted");
    }

    function _requireVector(string memory json, Settled memory e) internal pure {
        uint256[] memory time = vm.parseJsonUintArray(json, ".expected.finishTime");
        uint256[] memory raw = vm.parseJsonUintArray(json, ".expected.rawOrder");
        uint256[] memory settlement = vm.parseJsonUintArray(json, ".expected.settlementOrder");
        uint256[] memory acquired = vm.parseJsonUintArray(json, ".expected.acquiredByCheckpoint");
        for (uint256 h; h < 5; ++h) {
            require(e.finishTime[h] == time[h], "finishTime");
            require(e.rawOrder[h] == raw[h], "rawOrder");
            require(e.settlementOrder[h] == settlement[h], "settlementOrder");
        }
        for (uint256 k; k < 3; ++k) {
            require(e.acquired[k] == acquired[k], "acquired");
        }
        require(e.rank == vm.parseJsonUint(json, ".expected.settlementRank"), "settlementRank");
        require(e.digest == vm.parseJsonBytes32(json, ".expected.digest"), "digest");
    }

    function _injectSeed(bytes32 sessionId, bytes32 seed) internal {
        bytes32 slot = bytes32(uint256(keccak256(abi.encode(sessionId, SESSIONS_SLOT))) + SEED_OFFSET);
        chain.store(address(game), slot, seed);
        require(game.getSession(sessionId).seed == seed, "seed slot");
    }

    function _setHash(uint256 blockNumber, bytes32 hash) internal {
        chain.setBlockhash(blockNumber, hash);
        chain.store(Eip2935.HISTORY, Eip2935.slot(blockNumber), hash);
    }

    function _case(string memory name) internal view returns (string memory) {
        string[] memory cases = _cases();
        for (uint256 i; i < cases.length; ++i) {
            if (_eq(vm.parseJsonString(cases[i], ".name"), name)) return cases[i];
        }
        revert(string.concat("no vector ", name));
    }

    /// @dev The trailing number of `derived-<i>` or `fuzz-derived-<i>` (both use stake tier i % 4 + 1).
    function _index(string memory name) internal pure returns (uint256 index) {
        bytes memory b = bytes(name);
        uint256 start = b.length;
        while (start > 0 && b[start - 1] != "-") --start;
        for (uint256 i = start; i < b.length; ++i) {
            index = index * 10 + uint8(b[i]) - 48;
        }
    }
}
