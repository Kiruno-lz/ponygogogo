// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidCardRules} from "../../contracts/libraries/PaidCardRules.sol";
import {PonyGame} from "../../contracts/PonyGame.sol";
import {PonyVault} from "../../contracts/PonyVault.sol";
import {MockPaidRaceSolver} from "./MockPaidRaceSolver.sol";

struct VmLog {
    bytes32[] topics;
    bytes data;
    address emitter;
}

/// @dev The subset of Foundry cheatcodes these tests use (the repo has no forge-std).
interface PonyVm {
    function deal(address account, uint256 balance) external;
    function roll(uint256 height) external;
    function warp(uint256 timestamp) external;
    function setBlockhash(uint256 height, bytes32 hash) external;
    function etch(address target, bytes calldata code) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(address emitter) external;
    function expectCall(address callee, bytes calldata data) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (VmLog[] memory);
    function getBlockNumber() external view returns (uint256);
    function getBlockTimestamp() external view returns (uint256);
}

library Eip2935 {
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    address internal constant SYSTEM = 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE;
    /// @dev Runtime code of the EIP-2935 history contract as deployed on Monad Testnet.
    bytes internal constant RUNTIME =
        hex"3373fffffffffffffffffffffffffffffffffffffffe14604657602036036042575f35600143038111604257611fff81430311604257611fff9006545f5260205ff35b5f5ffd5b5f35611fff60014303065500";

    function slot(uint256 blockNumber) internal pure returns (bytes32) {
        return bytes32(blockNumber % 8191);
    }
}

/// @notice Deployment fixture: mock solver, Game, Vault, funded house (100 MON: five tier-4 reserves) and two funded
/// players.
abstract contract PonyGameBase {
    PonyVm internal constant vm = PonyVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    bytes32 internal constant RULESET = PaidCardRules.RULESET_HASH;
    uint256 internal constant HOUSE = 100 ether;
    /// @dev Covers one tier-4 (10 MON) stake per player with room to spare.
    uint256 internal constant DEPOSIT = 30 ether;
    uint256 internal constant TIER1 = 0.3 ether;
    uint256 internal constant TIER2 = 1 ether;
    uint256 internal constant TIER3 = 5 ether;
    uint256 internal constant TIER4 = 10 ether;
    uint256 internal constant START_BLOCK = 1_000;
    uint256 internal constant START_TIME = 1_750_000_000;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA201);

    MockPaidRaceSolver internal solver;
    PonyGame internal game;
    PonyVault internal vault;

    function setUp() public virtual {
        vm.roll(START_BLOCK);
        vm.warp(START_TIME);
        vm.etch(Eip2935.HISTORY, Eip2935.RUNTIME);
        solver = new MockPaidRaceSolver(RULESET);
        game = new PonyGame(address(this), solver);
        vault = new PonyVault(address(game), address(this));
        game.bindVault(vault);
        vm.deal(address(this), HOUSE);
        vault.fundHouse{value: HOUSE}();
        _fundPlayer(ALICE, DEPOSIT);
        _fundPlayer(BOB, DEPOSIT);
        game.setEntryPaused(false);
    }

    function _fundPlayer(address player, uint256 amount) internal {
        vm.deal(player, amount);
    }

    function _open(address player, uint8 horseId, uint256 stake) internal returns (bytes32 sessionId) {
        vm.prank(player);
        sessionId = game.openSession{value: stake}(horseId, stake);
    }

    /// @dev Advances `blocks` blocks and `secs` seconds, recording `hash` for every skipped block both as
    /// BLOCKHASH and in the EIP-2935 ring buffer, like a real chain would.
    function _mine(uint256 blocks, uint256 secs) internal {
        uint256 from = vm.getBlockNumber();
        vm.roll(from + blocks);
        vm.warp(vm.getBlockTimestamp() + secs);
        for (uint256 b = from; b < from + blocks; ++b) {
            _recordHash(b, _hashOf(b));
        }
    }

    /// @dev Jumps without recording history, as if the ring buffer had long moved on.
    function _jump(uint256 blocks, uint256 secs) internal {
        vm.roll(vm.getBlockNumber() + blocks);
        vm.warp(vm.getBlockTimestamp() + secs);
    }

    function _recordHash(uint256 blockNumber, bytes32 hash) internal {
        vm.setBlockhash(blockNumber, hash);
        vm.store(Eip2935.HISTORY, Eip2935.slot(blockNumber), hash);
    }

    function _hashOf(uint256 blockNumber) internal pure returns (bytes32) {
        return keccak256(abi.encode("block", blockNumber));
    }

    function _elapsed(bytes32 sessionId) internal view returns (uint256) {
        return vm.getBlockTimestamp() - game.getSession(sessionId).openedAt;
    }

    /// @dev Warps so that the next transaction lands exactly `txSec` seconds after T0.
    function _warpToTxSec(bytes32 sessionId, uint256 txSec) internal {
        vm.warp(uint256(game.getSession(sessionId).openedAt) + txSec);
    }

    function _assertVault() internal view {
        uint256 l = vault.totalLocked();
        uint256 h = vault.houseLiquidity();
        require(address(vault).balance >= l + h, "vault: balance < L + H");
        require(h >= vault.reservedLiquidity(), "vault: H < R");
    }

    function _stakeLockState(bytes32 sessionId) internal view returns (uint8 state) {
        (,,,, state) = vault.stakeLocks(sessionId);
    }

    function _noRefresh() internal pure returns (uint8[] memory) {
        return new uint8[](0);
    }

    function _eq(bytes memory a, bytes memory b) internal pure returns (bool) {
        return keccak256(a) == keccak256(b);
    }

    function _inputDigest(IPaidRaceSolver.RaceInput memory input) internal pure returns (bytes32) {
        return keccak256(abi.encode(input));
    }
}
