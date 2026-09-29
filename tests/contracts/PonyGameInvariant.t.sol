// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PonyGame} from "../../contracts/PonyGame.sol";
import {PonyVault} from "../../contracts/PonyVault.sol";
import {MockPaidRaceSolver} from "./MockPaidRaceSolver.sol";
import {Eip2935, PonyGameBase, PonyVm} from "./PonyGameBase.sol";

/// @notice Random session traffic for the invariant campaign (会话协议 v2: no refunds). Every action is a real
/// protocol call; a revert just discards that step, so ghosts only move on success. Choices are arbitrary: chooseCard
/// stores whatever passes its shape checks.
contract PonyGameHandler {
    PonyVm constant vm = PonyVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    PonyGame public immutable game;
    PonyVault public immutable vault;
    MockPaidRaceSolver public immutable solver;
    address public immutable owner;
    address[3] public actors;

    bytes32[] public sessions;
    mapping(bytes32 => uint256) public stakeOf;
    uint256 public expectedHouse;
    uint256 public deposits;
    uint256 public withdrawals;
    uint256[8] public successes; // open, choose, mine, settle, forfeit (lost anchor), forfeit (solver fault), seal, cash

    constructor(PonyGame game_, PonyVault vault_, MockPaidRaceSolver solver_, address owner_, uint256 house) {
        game = game_;
        vault = vault_;
        solver = solver_;
        owner = owner_;
        expectedHouse = house;
        actors = [address(0xA11CE), address(0xB0B), address(0xCA201)];
        for (uint256 i; i < 3; ++i) {
            vm.prank(actors[i]);
            game_.configureAgentBudget(type(uint64).max, 1_000 ether);
        }
    }

    function sessionCount() external view returns (uint256) {
        return sessions.length;
    }

    function open(uint256 actorSeed, uint8 horseSeed, uint8 tierSeed, bool agent) external {
        address actor = actors[actorSeed % 3];
        uint256 stake = game.stakeForTier(tierSeed % 4 + 1);
        vm.prank(actor);
        bytes32 sessionId = agent ? game.openAgentSession(horseSeed % 5, stake) : game.openSession(horseSeed % 5, stake);
        sessions.push(sessionId);
        stakeOf[sessionId] = stake;
        ++successes[0];
    }

    function choose(uint256 actorSeed, uint8 checkpointSeed, uint8 cardSeed, uint8 refreshSeed) external {
        address actor = actors[actorSeed % 3];
        bytes32 sessionId = game.sessionOf(actor);
        PonyGame.SessionView memory s = game.getSession(sessionId);
        require(s.state == 1 && s.lastCheckpoint < 3, "nothing to choose");
        uint8 checkpoint = s.lastCheckpoint + 1 + checkpointSeed % (3 - s.lastCheckpoint);
        uint8[] memory slots = new uint8[](refreshSeed % 4);
        for (uint256 i; i < slots.length; ++i) {
            slots[i] = uint8((refreshSeed >> (2 * i)) % 3);
        }
        vm.prank(actor);
        game.chooseCard(sessionId, checkpoint, cardSeed % 27, slots);
        ++successes[1];
    }

    function mine(uint8 blockSeed, uint8 secSeed, uint8 farSeed) external {
        uint256 from = vm.getBlockNumber();
        if (farSeed % 16 == 0) {
            // Long silence: every unsealed anchor falls out of the EIP-2935 window.
            vm.roll(from + 9_000);
            vm.warp(vm.getBlockTimestamp() + 3_150);
        } else {
            uint256 blocks = uint256(blockSeed % 40) + 1;
            vm.roll(from + blocks);
            vm.warp(vm.getBlockTimestamp() + secSeed % 30);
            for (uint256 b = from; b < from + blocks; ++b) {
                bytes32 hash = keccak256(abi.encode("block", b));
                vm.setBlockhash(b, hash);
                vm.store(Eip2935.HISTORY, Eip2935.slot(b), hash);
            }
        }
        ++successes[2];
    }

    function settle(uint256 actorSeed, uint8 rawSeed, uint8 rankSeed, uint8 wallSeed) external {
        bytes32 sessionId = game.sessionOf(actors[actorSeed % 3]);
        solver.setOutcome(rawSeed % 5 + 1, rankSeed % 5 + 1, uint32(wallSeed % 120) * 1000);
        uint256 payout = game.settleSession(sessionId);
        expectedHouse = expectedHouse + stakeOf[sessionId] - payout;
        ++successes[3];
    }

    /// @dev Anyone, once a required anchor is lost: payout 0, the stake joins the house.
    function forfeit(uint256 actorSeed) external {
        bytes32 sessionId = game.sessionOf(actors[actorSeed % 3]);
        game.forfeitSession(sessionId);
        expectedHouse += stakeOf[sessionId];
        ++successes[4];
    }

    /// @dev The owner, a day after T0, while the solver fails (the fault is switched on for this call only).
    function ownerForfeit(uint256 actorSeed) external {
        bytes32 sessionId = game.sessionOf(actors[actorSeed % 3]);
        uint256 availableAt = uint256(game.getSession(sessionId).openedAt) + game.FORFEIT_DELAY();
        if (availableAt > vm.getBlockTimestamp()) vm.warp(availableAt);
        solver.setSolveReverts(true);
        vm.prank(owner);
        game.forfeitSession(sessionId);
        solver.setSolveReverts(false);
        expectedHouse += stakeOf[sessionId];
        ++successes[5];
    }

    function seal(uint256 actorSeed) external {
        game.sealAnchors(game.sessionOf(actors[actorSeed % 3]));
        ++successes[6];
    }

    function deposit(uint256 actorSeed, uint96 amountSeed) external {
        address actor = actors[actorSeed % 3];
        uint256 amount = uint256(amountSeed) % 2 ether + 1;
        vm.deal(actor, amount);
        vm.prank(actor);
        vault.deposit{value: amount}();
        deposits += amount;
        ++successes[7];
    }

    function withdraw(uint256 actorSeed, uint96 amountSeed) external {
        address actor = actors[actorSeed % 3];
        uint256 amount = uint256(amountSeed) % (vault.available(actor) + 1);
        vm.prank(actor);
        vault.withdraw(amount);
        withdrawals += amount;
        ++successes[7];
    }
}

struct FuzzSelector {
    address addr;
    bytes4[] selectors;
}

contract PonyGameInvariantTest is PonyGameBase {
    uint256 constant INITIAL_DEPOSITS = 2 * DEPOSIT;
    PonyGameHandler handler;

    function setUp() public override {
        super.setUp();
        handler = new PonyGameHandler(game, vault, solver, address(this), HOUSE);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = PonyGameHandler.open.selector;
        selectors[1] = PonyGameHandler.choose.selector;
        selectors[2] = PonyGameHandler.mine.selector;
        selectors[3] = PonyGameHandler.settle.selector;
        selectors[4] = PonyGameHandler.forfeit.selector;
        selectors[5] = PonyGameHandler.ownerForfeit.selector;
        selectors[6] = PonyGameHandler.seal.selector;
        selectors[7] = PonyGameHandler.deposit.selector;
        selectors[8] = PonyGameHandler.withdraw.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector(address(handler), selectors);
    }

    /// forge-config: default.invariant.runs = 96
    /// forge-config: default.invariant.depth = 80
    function invariant_vaultConservesMonAndMatchesSessions() public view {
        uint256 a = vault.totalAvailable();
        uint256 l = vault.totalLocked();
        uint256 h = vault.houseLiquidity();
        uint256 balance = address(vault).balance;
        require(balance >= a + l + h && h >= vault.reservedLiquidity(), "solvency");
        require(balance == a + l + h, "untracked MON in the vault");
        require(balance == HOUSE + INITIAL_DEPOSITS + handler.deposits() - handler.withdrawals(), "MON created or lost");
        require(h == handler.expectedHouse(), "house moved outside settlement and forfeits");

        uint256 availableSum;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            availableSum += vault.available(actor);
            bytes32 active = game.sessionOf(actor);
            if (active != bytes32(0)) {
                PonyGame.SessionView memory s = game.getSession(active);
                require(s.state == game.STATE_OPEN() && s.player == actor, "active pointer");
            }
        }
        require(availableSum == a, "available balances");

        uint256 locked;
        uint256 reserved;
        uint256 count = handler.sessionCount();
        for (uint256 i; i < count; ++i) {
            bytes32 sessionId = handler.sessions(i);
            PonyGame.SessionView memory s = game.getSession(sessionId);
            (,,,, uint8 lockState) = vault.stakeLocks(sessionId);
            // A forfeit settles the stake with payout 0, so Game FORFEITED maps to Vault settled.
            uint8 expectedLock = s.state == game.STATE_FORFEITED() ? 2 : s.state;
            require(lockState == expectedLock, "game and vault disagree on a session");
            if (s.state == game.STATE_OPEN()) {
                require(game.sessionOf(s.player) == sessionId, "open session lost its pointer");
                locked += s.stake;
                reserved += 2 * s.stake;
            }
        }
        require(locked == l && reserved == vault.reservedLiquidity(), "locks and reserves");
    }

    /// @dev Deterministic walk through every handler path, so the campaign above is known not to be vacuous.
    function testHandlerReachesEveryPath() public {
        handler.open(0, 1, 1, false);
        handler.mine(1, 30, 1);
        handler.choose(0, 0, 9, 1);
        handler.mine(1, 1, 1);
        handler.seal(0);
        handler.settle(0, 0, 0, 0);
        handler.open(1, 2, 3, true);
        handler.mine(1, 0, 16);
        handler.forfeit(1);
        handler.deposit(2, 1 ether);
        handler.open(2, 0, 0, false);
        handler.mine(1, 0, 1);
        handler.ownerForfeit(2);
        handler.deposit(0, 1 ether);
        handler.withdraw(0, 0.5 ether);
        for (uint256 i; i < 8; ++i) {
            require(handler.successes(i) > 0, "handler path never succeeded");
        }
        invariant_vaultConservesMonAndMatchesSessions();
    }
}
