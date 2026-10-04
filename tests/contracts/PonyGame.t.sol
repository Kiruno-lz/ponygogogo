// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentBudget} from "../../contracts/abstracts/AgentBudget.sol";
import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidSeed} from "../../contracts/libraries/PaidSeed.sol";
import {PonyGame} from "../../contracts/PonyGame.sol";
import {PonyVault} from "../../contracts/PonyVault.sol";
import {RandomAnchor} from "../../contracts/libraries/RandomAnchor.sol";
import {MockPaidRaceSolver} from "./MockPaidRaceSolver.sol";
import {Eip2935, PonyGameBase, VmLog} from "./PonyGameBase.sol";

/// @notice 会话协议 v2 with a mock solver: cheap chooseCard records, anchor sealing, settlement, forfeits (no refunds).
contract PonyGameTest is PonyGameBase {
    receive() external payable {}

    // ------------------------------------------------------------ helpers

    function _choose(address player, bytes32 sessionId, uint8 checkpoint, uint8 cardId, uint8[] memory slots) internal {
        vm.prank(player);
        game.chooseCard(sessionId, checkpoint, cardId, slots);
    }

    function _slots(uint8 a) internal pure returns (uint8[] memory slots) {
        slots = new uint8[](1);
        slots[0] = a;
    }

    function _slots(uint8 a, uint8 b) internal pure returns (uint8[] memory slots) {
        slots = new uint8[](2);
        slots[0] = a;
        slots[1] = b;
    }

    function _slots(uint8 a, uint8 b, uint8 c) internal pure returns (uint8[] memory slots) {
        slots = new uint8[](3);
        slots[0] = a;
        slots[1] = b;
        slots[2] = c;
    }

    /// @dev Next block, no earlier than the first second the mock's `wallMs` finish allows. Never warps back.
    function _finish(bytes32 sessionId, uint8 rank, uint32 wallMs) internal {
        solver.setOutcome(rank, rank, wallMs);
        _mine(1, 0);
        uint256 target = uint256(game.getSession(sessionId).openedAt) + (uint256(wallMs) + 999) / 1000;
        if (target > vm.getBlockTimestamp()) vm.warp(target);
    }

    function _settleNow(bytes32 sessionId, uint8 rank) internal returns (uint256 payout) {
        _finish(sessionId, rank, 1_000);
        vm.prank(CAROL);
        payout = game.settleSession(sessionId);
    }

    /// @dev Leaves the open anchor unsealed until it falls out of the EIP-2935 window, then anyone forfeits.
    function _forfeitLost(bytes32 sessionId) internal {
        _mine(1, 0);
        _jump(9_000, 3_000);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
    }

    function _warpToForfeitDelay(bytes32 sessionId) internal {
        uint256 availableAt = uint256(game.getSession(sessionId).openedAt) + game.FORFEIT_DELAY();
        if (availableAt > vm.getBlockTimestamp()) vm.warp(availableAt);
    }

    function _canForfeit(bytes32 sessionId) internal view returns (bool ok, uint8 reason) {
        return game.canForfeit(sessionId);
    }

    function _vaultSnapshot() internal view returns (uint256[4] memory totals) {
        totals = [vault.totalLocked(), vault.houseLiquidity(), vault.reservedLiquidity(), address(vault).balance];
    }

    function _selectorMissing(address target, bytes memory call) internal returns (bool) {
        (bool ok, bytes memory ret) = target.call(call);
        return !ok && ret.length == 0;
    }

    // ------------------------------------------------------------ construction and admin

    function testConstructorFixesSolverRulesetAndPausedEntry() public {
        require(address(game.solver()) == address(solver) && game.rulesetHash() == RULESET, "binding");
        require(address(game.vault()) == address(vault) && game.owner() == address(this), "wiring");
        PonyGame fresh = new PonyGame(address(this), solver, rewards);
        require(fresh.entryPaused(), "entry must start paused");
        vm.expectRevert(PonyGame.InvalidConfiguration.selector);
        new PonyGame(address(this), IPaidRaceSolver(address(0xdead)), rewards);
        MockPaidRaceSolver unnamed = new MockPaidRaceSolver(bytes32(0));
        vm.expectRevert(PonyGame.InvalidConfiguration.selector);
        new PonyGame(address(this), unnamed, rewards);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PonyGame(address(0), solver, rewards);
    }

    function testBindVaultOnceToAVaultOfThisGame() public {
        PonyGame fresh = new PonyGame(address(this), solver, rewards);
        fresh.setEntryPaused(false);
        vm.expectRevert(PonyGame.InvalidConfiguration.selector);
        vm.prank(ALICE);
        fresh.openSession{value: TIER1}(0, TIER1);
        vm.expectRevert(PonyGame.InvalidConfiguration.selector);
        fresh.bindVault(vault);
        PonyVault own = new PonyVault(address(fresh), address(this));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        vm.prank(ALICE);
        fresh.bindVault(own);
        vm.expectEmit(address(fresh));
        emit PonyGame.VaultBound(address(own));
        fresh.bindVault(own);
        vm.expectRevert(PonyGame.InvalidConfiguration.selector);
        fresh.bindVault(own);
    }

    function testEntryPauseBlocksOnlyNewSessions() public {
        bytes32 sessionId = _open(ALICE, 1, TIER2);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        vm.prank(ALICE);
        game.setEntryPaused(true);
        vm.expectEmit(address(game));
        emit PonyGame.EntryPauseChanged(true);
        game.setEntryPaused(true);
        vm.expectRevert(PonyGame.EntryPaused.selector);
        vm.prank(BOB);
        game.openSession{value: TIER1}(0, TIER1);
        _mine(1, 0);
        _warpToTxSec(sessionId, 30);
        _choose(ALICE, sessionId, 1, 0, _noRefresh());
        _settleNow(sessionId, 1);
        require(game.getSession(sessionId).state == game.STATE_SETTLED(), "paused game must still settle");
        _assertVault();
    }

    function testRenounceOwnershipIsDisabled() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        vm.prank(ALICE);
        game.renounceOwnership();
        vm.expectRevert(PonyGame.RenounceDisabled.selector);
        game.renounceOwnership();
        require(game.owner() == address(this), "owner dropped");
    }

    /// @notice 会话协议 v2 has no refund entry point anywhere: Game and Vault reject the v1 selectors outright.
    function testNoRefundPathExists() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _warpToForfeitDelay(sessionId);
        require(
            _selectorMissing(address(game), abi.encodeWithSignature("refundSession(bytes32)", sessionId)),
            "refundSession exists"
        );
        require(
            _selectorMissing(address(game), abi.encodeWithSignature("emergencyRefund(bytes32)", sessionId)),
            "emergencyRefund exists"
        );
        require(
            _selectorMissing(address(game), abi.encodeWithSignature("canRefund(bytes32)", sessionId)),
            "canRefund exists"
        );
        vm.prank(address(game));
        require(
            _selectorMissing(address(vault), abi.encodeWithSignature("refundStake(bytes32)", sessionId)),
            "refundStake exists"
        );
        require(game.getSession(sessionId).state == game.STATE_OPEN(), "state moved");
    }

    // ------------------------------------------------------------ open

    function testOpenEachTierFixesSessionAndLocksStake() public {
        uint256[4] memory stakes = [TIER1, TIER2, TIER3, TIER4];
        for (uint8 i; i < 4; ++i) {
            address player = address(uint160(0x1000 + i));
            _fundPlayer(player, 11 ether);
            bytes32 expectedId = keccak256(abi.encode(address(game), block.chainid, player, uint256(1)));
            bytes32 expectedSeed = PaidSeed.derive(block.chainid, address(game), player, 1);
            uint64 t0 = uint64(vm.getBlockTimestamp());
            uint64 b0 = uint64(vm.getBlockNumber());
            vm.expectEmit(address(game));
            emit PonyGame.SessionOpened(expectedId, player, i, stakes[i], expectedSeed, t0, b0, RULESET);
            vm.expectEmit(address(vault));
            emit PonyVault.StakeLocked(expectedId, player, stakes[i], 3 * stakes[i], 2 * stakes[i]);
            bytes32 sessionId = _open(player, i, stakes[i]);
            require(sessionId == expectedId, "session id");
            require(game.stakeTier(stakes[i]) == i + 1 && game.stakeForTier(i + 1) == stakes[i], "tier table");

            PonyGame.SessionView memory s = game.getSession(sessionId);
            require(s.player == player && s.state == 1 && s.playerHorseId == i, "identity");
            require(s.stakeTier == i + 1 && s.stake == stakes[i], "stake");
            require(s.openedAt == t0 && s.openedBlock == b0 && s.seed == expectedSeed, "seed and T0");
            require(s.openAnchor == bytes32(0) && s.lastCheckpoint == 0, "fresh session");
            for (uint256 c; c < 3; ++c) {
                require(!s.choices[c].present && s.choices[c].blockNumber == 0, "phantom choice");
            }
            require(game.sessionOf(player) == sessionId && game.nonces(player) == 1, "active session");
            require(player.balance == 11 ether - stakes[i], "stake not locked");
            (address lockPlayer, uint256 lockStake, uint256 maxPayout, uint256 reserve, uint8 state) =
                vault.stakeLocks(sessionId);
            require(lockPlayer == player && lockStake == stakes[i], "lock");
            require(maxPayout == 3 * stakes[i] && reserve == 2 * stakes[i] && state == 1, "reserve");
            _mine(1, 1);
        }
        require(vault.totalLocked() == 16.3 ether && vault.reservedLiquidity() == 32.6 ether, "totals");
        _assertVault();
    }

    function testOpenRejectsInvalidHorseOrStake() public {
        // The v1 tiers (0.05 / 0.1 / 0.5 MON) are gone; stakes compare by exact wei.
        uint256[7] memory badStakes = [uint256(0), 0.05 ether, 0.1 ether, 0.5 ether, TIER1 + 1, TIER4 - 1, 2 ether];
        for (uint256 i; i < badStakes.length; ++i) {
            require(game.stakeTier(badStakes[i]) == 0, "not a tier");
            vm.expectRevert(PonyGame.InvalidEntry.selector);
            _open(ALICE, 0, badStakes[i]);
        }
        vm.expectRevert(PonyGame.InvalidEntry.selector);
        _open(ALICE, 5, TIER1);
        vm.expectRevert(PonyGame.InvalidEntry.selector);
        game.stakeForTier(0);
        vm.expectRevert(PonyGame.InvalidEntry.selector);
        game.stakeForTier(5);
        require(game.nonces(ALICE) == 0 && ALICE.balance == DEPOSIT, "failed open mutated state");
    }

    /// @notice The house must hold 2× the stake as reserve: tier 4 (10 MON) needs 20 MON of free liquidity.
    function testOpenNeedsPlayerBalanceAndHouseReserve() public {
        vm.prank(CAROL);
        (bool funded,) = address(game).call{value: TIER1}(abi.encodeCall(PonyGame.openSession, (0, TIER1)));
        require(!funded, "unfunded account opened");
        require(game.nonces(CAROL) == 0 && game.sessionOf(CAROL) == bytes32(0), "failed open kept state");
        vault.withdrawHouse(HOUSE - 19.9 ether);
        vm.expectRevert(PonyVault.InsufficientHouseLiquidity.selector);
        _open(ALICE, 0, TIER4);
        require(game.nonces(ALICE) == 0 && ALICE.balance == DEPOSIT, "rejected open kept state");
        _open(ALICE, 0, TIER3);
        require(vault.withdrawableHouse() == 9.9 ether, "tier 3 reserve");
        _fundHouse(0.1 ether);
        vm.expectRevert(PonyVault.InsufficientHouseLiquidity.selector);
        _open(BOB, 1, TIER4);
        _fundHouse(10 ether);
        _open(BOB, 1, TIER4);
        require(vault.withdrawableHouse() == 0 && vault.reservedLiquidity() == 30 ether, "exact tier 4 reserve");
        _assertVault();
    }

    function _fundHouse(uint256 amount) internal {
        vm.deal(address(this), amount);
        vault.fundHouse{value: amount}();
    }

    function testSingleActiveSessionAndMonotonicNonce() public {
        bytes32 first = _open(ALICE, 0, TIER1);
        vm.expectRevert(PonyGame.ActiveSession.selector);
        _open(ALICE, 1, TIER2);
        vm.prank(ALICE);
        game.configureAgentBudget(uint64(vm.getBlockTimestamp() + 1 days), 1 ether);
        vm.expectRevert(PonyGame.ActiveSession.selector);
        vm.prank(ALICE);
        game.openAgentSession{value: TIER1}(1, TIER1);
        require(game.sessionOf(ALICE) == first && game.nonces(ALICE) == 1, "active session overwritten");

        _settleNow(first, 3);
        bytes32 second = _open(ALICE, 0, TIER1);
        require(second != first && game.nonces(ALICE) == 2, "nonce");
        require(game.getSession(second).seed == PaidSeed.derive(block.chainid, address(game), ALICE, 2), "seed");
        require(game.getSession(second).seed != game.getSession(first).seed, "seed reused");

        _forfeitLost(second);
        bytes32 third = _open(ALICE, 0, TIER1);
        require(game.nonces(ALICE) == 3 && third != second, "nonce reset after forfeit");
        _assertVault();
    }

    function testAgentSessionSpendsBudgetFirstAndRevokes() public {
        uint64 expiry = uint64(vm.getBlockTimestamp() + 1 days);
        vm.expectRevert(AgentBudget.AgentBudgetExceeded.selector);
        vm.prank(ALICE);
        game.openAgentSession{value: TIER1}(1, TIER1);

        vm.prank(ALICE);
        game.configureAgentBudget(expiry, 1.3 ether);
        vm.expectEmit(address(game));
        emit AgentBudget.AgentBudgetSpent(ALICE, TIER2, TIER2);
        vm.prank(ALICE);
        bytes32 first = game.openAgentSession{value: TIER2}(1, TIER2);
        require(game.sessionOf(ALICE) == first, "agent session");
        _settleNow(first, 3);

        vm.expectRevert(AgentBudget.AgentBudgetExceeded.selector);
        vm.prank(ALICE);
        game.openAgentSession{value: TIER2}(1, TIER2);

        game.setEntryPaused(true);
        vm.expectRevert(PonyGame.EntryPaused.selector);
        vm.prank(ALICE);
        game.openAgentSession{value: TIER1}(1, TIER1);
        (,, uint256 spent) = game.agentBudgets(ALICE);
        require(spent == TIER2, "failed open consumed budget");
        game.setEntryPaused(false);

        vm.prank(ALICE);
        bytes32 second = game.openAgentSession{value: TIER1}(1, TIER1);
        (,, spent) = game.agentBudgets(ALICE);
        require(spent == 1.3 ether, "cumulative spend");
        _settleNow(second, 2);

        vm.prank(ALICE);
        game.revokeAgentBudget();
        vm.expectRevert(AgentBudget.AgentBudgetExceeded.selector);
        vm.prank(ALICE);
        game.openAgentSession{value: TIER1}(1, TIER1);
        bytes32 direct = _open(ALICE, 1, TIER1);
        require(direct != bytes32(0), "revocation blocked the player's own entry");
        _settleNow(direct, 1);

        vm.prank(ALICE);
        game.configureAgentBudget(uint64(vm.getBlockTimestamp() + 10), 1 ether);
        vm.warp(vm.getBlockTimestamp() + 10);
        vm.expectRevert(AgentBudget.AgentBudgetExceeded.selector);
        vm.prank(ALICE);
        game.openAgentSession{value: TIER1}(1, TIER1);
        _assertVault();
    }

    // ------------------------------------------------------------ chooseCard

    function testChooseCardOnlyByPlayerOfAnOpenSession() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(1, 0);
        _warpToTxSec(sessionId, 30);
        vm.expectRevert(PonyGame.NotSessionPlayer.selector);
        _choose(BOB, sessionId, 1, 0, _noRefresh());
        vm.expectRevert(PonyGame.NotSessionPlayer.selector);
        _choose(CAROL, sessionId, 1, 0, _noRefresh());
        vm.expectRevert(PonyGame.UnknownSession.selector);
        _choose(ALICE, keccak256("nope"), 1, 0, _noRefresh());
        _choose(ALICE, sessionId, 1, 0, _noRefresh());
    }

    /// @notice The only checks chooseCard makes: checkpoint 1..3 strictly increasing, cardId <= 40, at most three
    /// refreshes, each slot <= 2. Checkpoints may be skipped.
    function testChooseCardShapeChecks() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(1, 0);
        _warpToTxSec(sessionId, 60);
        vm.expectRevert(PonyGame.InvalidCheckpoint.selector);
        _choose(ALICE, sessionId, 0, 0, _noRefresh());
        vm.expectRevert(PonyGame.InvalidCheckpoint.selector);
        _choose(ALICE, sessionId, 4, 0, _noRefresh());
        vm.expectRevert(PonyGame.InvalidCard.selector);
        _choose(ALICE, sessionId, 2, 41, _noRefresh());
        vm.expectRevert(PonyGame.InvalidCard.selector);
        _choose(ALICE, sessionId, 2, 255, _noRefresh());
        vm.expectRevert(PonyGame.TooManyRefreshes.selector);
        _choose(ALICE, sessionId, 2, 0, new uint8[](4));
        vm.expectRevert(PonyGame.InvalidRefreshSlot.selector);
        _choose(ALICE, sessionId, 2, 0, _slots(0, 3));
        vm.expectRevert(PonyGame.InvalidRefreshSlot.selector);
        _choose(ALICE, sessionId, 2, 0, _slots(255));

        _choose(ALICE, sessionId, 2, 26, _slots(2, 2, 2));
        _mine(1, 0);
        vm.expectRevert(PonyGame.InvalidCheckpoint.selector);
        _choose(ALICE, sessionId, 1, 0, _noRefresh());
        vm.expectRevert(PonyGame.InvalidCheckpoint.selector);
        _choose(ALICE, sessionId, 2, 0, _noRefresh());
        _warpToTxSec(sessionId, 90);
        _choose(ALICE, sessionId, 3, 0, _noRefresh());
        _mine(1, 0);
        vm.expectRevert(PonyGame.InvalidCheckpoint.selector);
        _choose(ALICE, sessionId, 3, 0, _noRefresh());

        PonyGame.SessionView memory s = game.getSession(sessionId);
        require(!s.choices[0].present && s.choices[1].present && s.choices[2].present, "timeout left a record");
        require(s.lastCheckpoint == 3, "last checkpoint");
    }

    /// @notice chooseCard never runs the solver: any second, any legal-shaped card and refresh list is stored as sent
    /// (the settlement solve decides whether it counts), even while the solver would revert.
    function testChooseCardAcceptsAnySecondWithoutTheSolver() public {
        solver.setSolveReverts(true);
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _choose(ALICE, sessionId, 1, 26, _slots(1, 1, 1)); // same block and second as the open
        _mine(1, 0);
        _jump(0, 4_000_000);
        _choose(ALICE, sessionId, 2, 0, _slots(0, 0));
        _choose(ALICE, sessionId, 3, 1, _noRefresh()); // same block as the previous choice
        PonyGame.SessionView memory s = game.getSession(sessionId);
        require(s.choices[0].txSec == 0 && s.choices[0].cardId == 26, "open-second choice");
        require(_eq(abi.encode(s.choices[0].refreshSlots), abi.encode(_slots(1, 1, 1))), "repeated slots kept");
        require(s.choices[1].txSec == 4_000_000 && s.choices[2].txSec == 4_000_000, "late choices");
        require(s.choices[1].blockNumber == s.choices[2].blockNumber, "two choices in one block");
        solver.setSolveReverts(false);
        _mine(1, 0);
        IPaidRaceSolver.RaceInput memory input = game.raceInput(sessionId);
        require(input.choices[0].present && input.choices[0].txSec == 0, "passed to the solver unchanged");
        require(input.choices[2].cardId == 1 && input.choices[2].anchor == _hashOf(s.choices[2].blockNumber), "anchor");
    }

    function testChooseCardStoresTransactionFactsAndEmits() public {
        bytes32 sessionId = _open(ALICE, 2, TIER2);
        uint64 b0 = game.getSession(sessionId).openedBlock;
        _mine(3, 0);
        _warpToTxSec(sessionId, 35);
        uint64 b1 = uint64(vm.getBlockNumber());
        uint8[] memory slots = _slots(2, 0);
        vm.expectEmit(address(game));
        emit PonyGame.RandomAnchorSealed(sessionId, b0, _hashOf(b0));
        vm.expectEmit(address(game));
        emit PonyGame.CardChosen(sessionId, ALICE, 1, 17, slots, 35, b1);
        _choose(ALICE, sessionId, 1, 17, slots);

        PonyGame.SessionView memory s = game.getSession(sessionId);
        require(s.openAnchor == _hashOf(b0) && s.lastCheckpoint == 1, "open anchor sealed");
        PonyGame.ChoiceView memory c = s.choices[0];
        require(c.present && c.txSec == 35 && c.blockNumber == b1 && c.cardId == 17, "choice facts");
        require(_eq(abi.encode(c.refreshSlots), abi.encode(slots)), "refresh slots");
        require(c.anchor == bytes32(0), "own anchor cannot be known in its block");
        require(!s.choices[1].present && !s.choices[2].present, "later choices");
    }

    /// @notice chooseCard seals the open anchor and earlier choice anchors that are readable now and silently skips
    /// the rest: one pending in the current block, or one already lost.
    function testChooseCardSealsReadableEarlierAnchorsOnly() public {
        bytes32 sessionId = _open(ALICE, 3, TIER2);
        uint64 b0 = game.getSession(sessionId).openedBlock;
        vm.recordLogs();
        _choose(ALICE, sessionId, 1, 5, _noRefresh()); // open block: nothing readable yet
        require(vm.getRecordedLogs().length == 1, "sealed something in the open block");
        require(game.getSession(sessionId).openAnchor == bytes32(0), "open anchor sealed early");

        _mine(300, 0); // both anchors are now only in EIP-2935
        _warpToTxSec(sessionId, 61);
        vm.expectEmit(address(game));
        emit PonyGame.RandomAnchorSealed(sessionId, b0, _hashOf(b0));
        vm.expectEmit(address(game));
        emit PonyGame.RandomAnchorSealed(sessionId, b0, _hashOf(b0));
        _choose(ALICE, sessionId, 2, 0, _slots(1));
        PonyGame.SessionView memory s = game.getSession(sessionId);
        require(s.openAnchor == _hashOf(b0) && s.choices[0].anchor == _hashOf(b0), "history anchors sealed");
        require(s.choices[1].anchor == bytes32(0), "own anchor");

        _mine(1, 0);
        _jump(9_000, 3_000); // choice 2's anchor is lost
        _choose(ALICE, sessionId, 3, 0, _noRefresh());
        s = game.getSession(sessionId);
        require(s.choices[1].anchor == bytes32(0) && s.choices[2].present, "lost anchor skipped, choice stored");
        (bool ok, uint8 reason) = _canForfeit(sessionId);
        require(ok && reason == game.FORFEIT_ANCHOR_LOST(), "lost choice anchor forfeits");
    }

    function testChooseCardRejectedOnceSessionIsClosed() public {
        bytes32 settled = _open(ALICE, 0, TIER1);
        _settleNow(settled, 1);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        _choose(ALICE, settled, 1, 0, _noRefresh());
        bytes32 forfeited = _open(ALICE, 0, TIER1);
        _forfeitLost(forfeited);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        _choose(ALICE, forfeited, 1, 0, _noRefresh());
    }

    // ------------------------------------------------------------ anchors

    function testAnchorOfTheCurrentBlockIsUnreadable() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.raceInput(sessionId);
        require(game.sealAnchors(sessionId) == 0, "sealed a same-block hash");
        (bool ok,) = _canForfeit(sessionId);
        require(!ok, "same block is pending, not lost");
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.settleSession(sessionId);
    }

    function testAnchorOfTheNextBlockComesFromBlockhash() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        uint256 b0 = vm.getBlockNumber();
        vm.roll(b0 + 1);
        vm.setBlockhash(b0, keccak256("direct"));
        require(vm.load(Eip2935.HISTORY, Eip2935.slot(b0)) == bytes32(0), "history must be empty here");
        vm.expectEmit(address(game));
        emit PonyGame.RandomAnchorSealed(sessionId, uint64(b0), keccak256("direct"));
        require(game.sealAnchors(sessionId) == 1, "seal count");
        require(game.getSession(sessionId).openAnchor == keccak256("direct"), "blockhash anchor");
    }

    function testAnchor300BlocksBackComesFromEip2935() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        uint256 b0 = vm.getBlockNumber();
        vm.setBlockhash(b0, keccak256("stale blockhash"));
        vm.store(Eip2935.HISTORY, Eip2935.slot(b0), keccak256("history"));
        vm.roll(b0 + 300);
        require(game.raceInput(sessionId).openAnchor == keccak256("history"), "history anchor");
        (bool ok,) = _canForfeit(sessionId);
        require(!ok, "readable anchor forfeitable");
        game.sealAnchors(sessionId);
        require(game.getSession(sessionId).openAnchor == keccak256("history"), "sealed history anchor");
    }

    function testAnchor300BlocksBackIsLostWithoutHistoryContract() public {
        vm.etch(Eip2935.HISTORY, "");
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(300, 100);
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.raceInput(sessionId);
        (bool ok, uint8 reason) = _canForfeit(sessionId);
        require(ok && reason == 1, "unreadable anchor must allow a forfeit");
    }

    function testAnchor9000BlocksBackIsUnavailable() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(1, 0);
        _jump(8999, 3_000);
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.raceInput(sessionId);
        require(game.sealAnchors(sessionId) == 0, "sealed an expired anchor");
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.settleSession(sessionId);
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.previewSettlement(sessionId);
        (bool ok, uint8 reason) = _canForfeit(sessionId);
        require(ok && reason == 1, "expired anchor must allow a forfeit");
    }

    function testZeroHashIsNeverAnAnchor() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        uint256 b0 = vm.getBlockNumber();
        vm.roll(b0 + 300);
        require(vm.load(Eip2935.HISTORY, Eip2935.slot(b0)) == bytes32(0), "slot must be empty");
        vm.expectRevert(RandomAnchor.AnchorUnavailable.selector);
        game.raceInput(sessionId);
        require(game.sealAnchors(sessionId) == 0, "sealed a zero hash");
        require(game.getSession(sessionId).openAnchor == bytes32(0), "zero stored as anchor");
    }

    function testSealAnchorsIsPermissionlessAndIdempotent() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(2, 0);
        _warpToTxSec(sessionId, 30);
        uint64 b1 = uint64(vm.getBlockNumber());
        _choose(ALICE, sessionId, 1, 4, _noRefresh());
        _mine(1, 0);
        vm.expectEmit(address(game));
        emit PonyGame.RandomAnchorSealed(sessionId, b1, _hashOf(b1));
        vm.prank(CAROL);
        require(game.sealAnchors(sessionId) == 1, "one pending anchor");
        vm.recordLogs();
        require(game.sealAnchors(sessionId) == 0, "resealed");
        require(vm.getRecordedLogs().length == 0, "duplicate seal event");
        require(game.getSession(sessionId).choices[0].anchor == _hashOf(b1), "choice anchor");
    }

    // ------------------------------------------------------------ settle

    function testSettleWaitsForFinishWallThenAnyoneSettles() public {
        bytes32 sessionId = _open(ALICE, 1, TIER2);
        solver.setOutcome(2, 2, 45_300);
        _mine(1, 0);
        _warpToTxSec(sessionId, 45);
        vm.expectRevert(abi.encodeWithSelector(PonyGame.RaceNotFinished.selector, 45_000, 45_300));
        vm.prank(CAROL);
        game.settleSession(sessionId);
        (, uint256 previewPayout, uint256 settleableAt) = game.previewSettlement(sessionId);
        require(settleableAt == game.getSession(sessionId).openedAt + 46 && previewPayout == 1.5 ether, "preview");

        _warpToTxSec(sessionId, 46);
        vm.expectEmit(address(vault));
        emit PonyVault.StakeSettled(sessionId, ALICE, 1.5 ether);
        vm.prank(CAROL);
        require(game.settleSession(sessionId) == 1.5 ether, "payout");
        require(game.getSession(sessionId).state == game.STATE_SETTLED(), "state");
        require(game.sessionOf(ALICE) == bytes32(0) && _stakeLockState(sessionId) == 2, "closed");
        require(ALICE.balance == DEPOSIT - TIER2 + 1.5 ether, "player credited");
        require(CAROL.balance == 0, "settler credited");
        require(vault.houseLiquidity() == HOUSE + TIER2 - 1.5 ether, "house debited");
        _assertVault();
    }

    function testSettlePaysEachSettlementRankAndEmitsAcquired() public {
        uint256[5] memory expected = [uint256(3 ether), 1.5 ether, 1 ether, 0, 0];
        for (uint8 rank = 1; rank <= 5; ++rank) {
            bytes32 sessionId = _open(ALICE, 4, TIER2);
            _mine(1, 0);
            _warpToTxSec(sessionId, 20 + rank);
            _choose(ALICE, sessionId, 2, rank + 10, _noRefresh());
            _finish(sessionId, rank, 30_000);
            uint256 available = ALICE.balance;
            uint256 house = vault.houseLiquidity();
            (IPaidRaceSolver.RaceResult memory result, uint256 payout,) = game.previewSettlement(sessionId);
            require(payout == expected[rank - 1], "multiplier table");
            require(result.acquired[0] == 0 && result.acquired[1] == rank + 10 && result.acquired[2] == 0, "mock");
            bytes32 digest = _inputDigest(game.raceInput(sessionId));
            require(result.digest == digest, "mock digest");
            vm.expectEmit(address(game));
            emit PonyGame.SessionSettled(
                sessionId,
                ALICE,
                result.finishTime,
                result.rawOrder,
                result.settlementOrder,
                rank,
                payout,
                digest,
                result.acquired
            );
            require(game.settleSession(sessionId) == payout, "returned payout");
            require(ALICE.balance == available + payout, "player balance");
            require(vault.houseLiquidity() + payout == house + TIER2, "house balance");
            require(vault.totalLocked() == 0 && vault.reservedLiquidity() == 0, "released");
            _assertVault();
        }
    }

    function testSettlePaysBySettlementRankNotRawRank() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        solver.setOutcome(5, 1, 20_000);
        _mine(1, 0);
        _warpToTxSec(sessionId, 20);
        require(game.settleSession(sessionId) == 0.9 ether, "version answer pays rank 1");
        _assertVault();
    }

    function testSettleSealsEveryAnchorAndSolvesTheStoredInput() public {
        bytes32 sessionId = _open(BOB, 1, TIER4);
        PonyGame.SessionView memory s = game.getSession(sessionId);
        uint64[3] memory blocks;
        _mine(1, 0);
        _warpToTxSec(sessionId, 30);
        blocks[0] = uint64(vm.getBlockNumber());
        _choose(BOB, sessionId, 1, 9, _slots(0));
        _mine(1, 0);
        _warpToTxSec(sessionId, 61);
        blocks[1] = uint64(vm.getBlockNumber());
        _choose(BOB, sessionId, 2, 0, _noRefresh());
        _mine(1, 0);
        _warpToTxSec(sessionId, 95);
        blocks[2] = uint64(vm.getBlockNumber());
        _choose(BOB, sessionId, 3, 21, _slots(1, 2));

        IPaidRaceSolver.RaceInput memory expected;
        expected.seed = s.seed;
        expected.openAnchor = _hashOf(s.openedBlock);
        expected.stakeTier = 4;
        expected.playerHorseId = 1;
        expected.choices[0] = IPaidRaceSolver.ChoiceInput(true, 30, 9, _slots(0), _hashOf(blocks[0]));
        expected.choices[1] = IPaidRaceSolver.ChoiceInput(true, 61, 0, _noRefresh(), _hashOf(blocks[1]));
        expected.choices[2] = IPaidRaceSolver.ChoiceInput(true, 95, 21, _slots(1, 2), _hashOf(blocks[2]));

        _finish(sessionId, 1, 120_000);
        vm.expectEmit(address(game));
        emit PonyGame.RandomAnchorSealed(sessionId, blocks[2], _hashOf(blocks[2]));
        vm.recordLogs();
        game.settleSession(sessionId);
        VmLog[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(game) || logs[i].topics[0] != PonyGame.SessionSettled.selector) continue;
            (,,,,, bytes32 digest, uint8[3] memory acquired) =
                abi.decode(logs[i].data, (uint32[5], uint8[5], uint8[5], uint8, uint256, bytes32, uint8[3]));
            require(digest == _inputDigest(expected), "solver saw a different input");
            require(acquired[0] == 9 && acquired[1] == 0 && acquired[2] == 21, "acquired is the last field");
            found = true;
        }
        require(found, "no settlement event");
        s = game.getSession(sessionId);
        for (uint256 i; i < 3; ++i) {
            require(s.choices[i].anchor == _hashOf(blocks[i]), "anchor not sealed");
        }
        require(BOB.balance == DEPOSIT - TIER4 + 30 ether, "tier 4 rank 1 payout");
        _assertVault();
    }

    function testSettleAndForfeitAreFinalAndExclusive() public {
        bytes32 settled = _open(ALICE, 0, TIER1);
        _settleNow(settled, 2);
        _mine(1, 0);
        _jump(9_000, 2 days);
        uint256[4] memory totals = _vaultSnapshot();
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.settleSession(settled);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.forfeitSession(settled);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.sealAnchors(settled);
        (bool ok, uint8 reason) = _canForfeit(settled);
        require(!ok && reason == 0, "settled session forfeitable");
        require(_eq(abi.encode(totals), abi.encode(_vaultSnapshot())), "closed session moved funds");

        bytes32 forfeited = _open(ALICE, 0, TIER1);
        _forfeitLost(forfeited);
        totals = _vaultSnapshot();
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.settleSession(forfeited);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.forfeitSession(forfeited);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.previewSettlement(forfeited);
        require(_eq(abi.encode(totals), abi.encode(_vaultSnapshot())), "forfeited session moved funds");
        _assertVault();
    }

    function testSettleRejectsInconsistentOrFailingSolver() public {
        bytes32 sessionId = _open(ALICE, 2, TIER1);
        _finish(sessionId, 2, 5_000);
        solver.setCorruptResult(true);
        vm.expectRevert(PonyGame.InvalidSolverResult.selector);
        game.settleSession(sessionId);
        vm.expectRevert(PonyGame.InvalidSolverResult.selector);
        game.previewSettlement(sessionId);
        solver.setCorruptResult(false);
        solver.setSolveReverts(true);
        vm.expectRevert(MockPaidRaceSolver.MockSolveFailed.selector);
        game.settleSession(sessionId);
        (bool ok,) = _canForfeit(sessionId);
        require(!ok, "a solver failure is not forfeitable before the delay");
        require(game.getSession(sessionId).state == game.STATE_OPEN(), "state");
    }

    function testSettleHasNoDeadline() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(1, 0);
        _warpToTxSec(sessionId, 30);
        _choose(ALICE, sessionId, 1, 0, _noRefresh());
        _mine(1, 0);
        game.sealAnchors(sessionId);
        _jump(20_000, 30 days);
        (bool ok,) = _canForfeit(sessionId);
        require(!ok, "sealed session forfeitable");
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        game.forfeitSession(sessionId);
        game.settleSession(sessionId);
        require(game.getSession(sessionId).state == game.STATE_SETTLED(), "late settlement");
        _assertVault();
    }

    // ------------------------------------------------------------ forfeit (reason 1: lost anchor)

    function testForfeitRejectedWhileAnchorsAreReadable() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
        _mine(1, 0);
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(ALICE);
        game.forfeitSession(sessionId);
        _mine(299, 100);
        (bool ok,) = _canForfeit(sessionId);
        require(!ok, "history-readable anchor forfeitable");
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
    }

    /// @notice The open anchor 8191 blocks back is still readable; one block later it is lost and anyone forfeits:
    /// payout 0, the stake joins house liquidity, the reserve is released.
    function testForfeitReason1AtExactlyTheWindowEdge() public {
        bytes32 sessionId = _open(ALICE, 0, TIER2);
        uint256 b0 = game.getSession(sessionId).openedBlock;
        _mine(1, 0);
        _jump(8_190, 3_000);
        require(vm.getBlockNumber() - b0 == 8_191, "edge block");
        (bool ok, uint8 reason) = _canForfeit(sessionId);
        require(!ok && reason == 0, "8191 blocks is still readable");
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
        require(game.raceInput(sessionId).openAnchor == _hashOf(b0), "still readable");

        _jump(1, 1);
        (ok, reason) = _canForfeit(sessionId);
        require(ok && reason == game.FORFEIT_ANCHOR_LOST(), "8192 blocks is lost");
        vm.expectEmit(address(game));
        emit PonyGame.SessionForfeited(sessionId, ALICE, TIER2, 1);
        vm.expectEmit(address(vault));
        emit PonyVault.StakeSettled(sessionId, ALICE, 0);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
        require(ALICE.balance == DEPOSIT - TIER2 && CAROL.balance == 0, "player forfeits the stake");
        require(vault.houseLiquidity() == HOUSE + TIER2 && vault.reservedLiquidity() == 0, "stake to the house");
        require(vault.totalLocked() == 0, "lock released");
        require(game.getSession(sessionId).state == game.STATE_FORFEITED(), "state");
        require(game.sessionOf(ALICE) == bytes32(0) && _stakeLockState(sessionId) == 2, "closed as settled 0");
        (ok,) = _canForfeit(sessionId);
        require(!ok, "forfeitable twice");
        _assertVault();
    }

    function testForfeitReason1WhenUnsealedChoiceAnchorIsLost() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(2, 0);
        _warpToTxSec(sessionId, 30);
        _choose(ALICE, sessionId, 1, 0, _noRefresh());
        _mine(1, 0);
        game.sealAnchors(sessionId); // seals the open anchor and the choice anchor
        _warpToTxSec(sessionId, 60);
        _choose(ALICE, sessionId, 2, 0, _noRefresh());
        _mine(1, 0);
        _jump(9_000, 3_000);
        require(game.getSession(sessionId).openAnchor != bytes32(0), "open anchor sealed");
        (bool ok, uint8 reason) = _canForfeit(sessionId);
        require(ok && reason == 1, "lost choice anchor");
        game.forfeitSession(sessionId); // the owner takes the permissionless path too
        require(ALICE.balance == DEPOSIT - TIER1, "no refund");
        _assertVault();
    }

    function testForfeitRejectedOnceAnchorsAreSealed() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(2, 0);
        _warpToTxSec(sessionId, 30);
        _choose(ALICE, sessionId, 1, 0, _noRefresh());
        _mine(1, 0);
        game.sealAnchors(sessionId);
        _jump(9_000, 3_000);
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(CAROL);
        game.forfeitSession(sessionId);
        _settleNow(sessionId, 4);
        require(ALICE.balance == DEPOSIT - TIER1, "rank 4 pays nothing");
        require(vault.houseLiquidity() == HOUSE + TIER1, "house keeps the stake");
        _assertVault();
    }

    // ------------------------------------------------------------ forfeit (reason 2: solver fault)

    /// @notice Only the owner, only FORFEIT_DELAY after T0, only while the settlement preview fails.
    function testForfeitReason2OnlyWhenSolveRevertsAndOnlyAfterOneDay() public {
        bytes32 sessionId = _open(ALICE, 0, TIER4);
        _mine(1, 0);
        uint256 availableAt = uint256(game.getSession(sessionId).openedAt) + 1 days;
        solver.setSolveReverts(true);
        vm.expectRevert(abi.encodeWithSelector(PonyGame.ForfeitTooEarly.selector, availableAt));
        game.forfeitSession(sessionId);
        vm.warp(availableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(PonyGame.ForfeitTooEarly.selector, availableAt));
        game.forfeitSession(sessionId);
        (bool ok,) = _canForfeit(sessionId);
        require(!ok, "forfeitable before the delay");

        vm.warp(availableAt);
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        vm.prank(ALICE);
        game.forfeitSession(sessionId);
        solver.setSolveReverts(false);
        (ok,) = _canForfeit(sessionId);
        require(!ok, "working solver forfeitable");
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        game.forfeitSession(sessionId);

        solver.setSolveReverts(true);
        uint8 reason;
        (ok, reason) = _canForfeit(sessionId);
        require(ok && reason == game.FORFEIT_SOLVER_FAULT(), "canForfeit reason 2");
        vm.expectEmit(address(game));
        emit PonyGame.SessionForfeited(sessionId, ALICE, TIER4, 2);
        vm.expectEmit(address(vault));
        emit PonyVault.StakeSettled(sessionId, ALICE, 0);
        game.forfeitSession(sessionId);
        require(ALICE.balance == DEPOSIT - TIER4, "no refund");
        require(address(this).balance == 0 && vault.houseLiquidity() == HOUSE + TIER4, "stake to the house");
        require(game.getSession(sessionId).state == game.STATE_FORFEITED(), "state");
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.forfeitSession(sessionId);
        _assertVault();
    }

    function testForfeitReason2CoversUnpayableAndGasExhaustingSolvers() public {
        bytes32 corrupt = _open(ALICE, 0, TIER1);
        bytes32 exhausting = _open(BOB, 1, TIER1);
        _mine(1, 0);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        solver.setCorruptResult(true);
        (bool ok, uint8 reason) = _canForfeit(corrupt);
        require(ok && reason == 2, "inconsistent rank is a solver fault");
        game.forfeitSession(corrupt);
        solver.setCorruptResult(false);
        solver.setSolveExhaustsGas(true);
        game.forfeitSession{gas: 29_700_000}(exhausting);
        require(game.getSession(exhausting).state == game.STATE_FORFEITED(), "exhausting solver");
        _assertVault();
    }

    /// @notice The owner cannot fake a solver fault by starving the probe: the forfeit refuses to start without
    /// FORFEIT_PROBE_GAS for it, and a heavy solve that fits the probe keeps the session settleable.
    function testForfeitReason2CannotBeForcedByStarvingGas() public {
        bytes32 sessionId = _open(ALICE, 0, TIER4);
        _finish(sessionId, 1, 40_000);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        solver.setSolveGasBurn(20_000_000);
        (bool ok, bytes memory ret) =
            address(game).call{gas: 21_000_000}(abi.encodeCall(PonyGame.forfeitSession, (sessionId)));
        require(!ok && bytes4(ret) == PonyGame.ForfeitProbeGasTooLow.selector, "starved probe accepted");
        (ok, ret) = address(game).call{gas: 29_700_000}(abi.encodeCall(PonyGame.forfeitSession, (sessionId)));
        require(!ok && bytes4(ret) == PonyGame.ForfeitNotAllowed.selector, "heavy working solve forfeited");
        solver.setSolveGasBurn(0);
        vm.prank(ALICE);
        require(game.settleSession(sessionId) == 30 ether, "winner settles");
        _assertVault();
    }

    function testOwnerCannotVoidAFinishedWinningSession() public {
        bytes32 sessionId = _open(ALICE, 0, TIER4);
        _finish(sessionId, 1, 40_000);
        _mine(300, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                PonyGame.ForfeitTooEarly.selector, uint256(game.getSession(sessionId).openedAt) + 1 days
            )
        );
        game.forfeitSession(sessionId);
        vm.warp(uint256(game.getSession(sessionId).openedAt) + 2 days);
        vm.expectRevert(PonyGame.ForfeitNotAllowed.selector);
        game.forfeitSession(sessionId);
        vm.prank(ALICE);
        require(game.settleSession(sessionId) == 30 ether, "winner settles whenever it likes");
        _assertVault();
    }

    // ------------------------------------------------------------ views

    function testViewsForUnknownAndLiveSessions() public {
        bytes32 unknown = keccak256("nope");
        PonyGame.SessionView memory empty = game.getSession(unknown);
        require(empty.player == address(0) && empty.state == 0 && empty.stake == 0, "unknown session view");
        (bool ok, uint8 reason) = _canForfeit(unknown);
        require(!ok && reason == 0, "unknown forfeitable");
        vm.expectRevert(PonyGame.UnknownSession.selector);
        game.raceInput(unknown);
        vm.expectRevert(PonyGame.UnknownSession.selector);
        game.previewSettlement(unknown);
        vm.expectRevert(PonyGame.UnknownSession.selector);
        game.forfeitSession(unknown);

        bytes32 sessionId = _open(ALICE, 2, TIER1);
        _mine(1, 0);
        IPaidRaceSolver.RaceInput memory input = game.raceInput(sessionId);
        PonyGame.SessionView memory s = game.getSession(sessionId);
        require(input.seed == s.seed && input.openAnchor == _hashOf(s.openedBlock), "input anchors");
        require(input.stakeTier == 1 && input.playerHorseId == 2 && !input.choices[0].present, "input fields");
        require(game.getSession(sessionId).openAnchor == bytes32(0), "view sealed");
        _settleNow(sessionId, 1);
        vm.expectRevert(PonyGame.SessionNotOpen.selector);
        game.previewSettlement(sessionId);
        require(game.raceInput(sessionId).openAnchor == _hashOf(s.openedBlock), "settled input");
    }

    // ------------------------------------------------------------ fuzz

    function testFuzzSettlementConservesVault(uint8 horseSeed, uint8 tierSeed, uint8 rawSeed, uint8 rankSeed) public {
        uint8 horse = horseSeed % 5;
        uint8 tier = tierSeed % 4 + 1;
        uint8 rank = rankSeed % 5 + 1;
        uint256 stake = game.stakeForTier(tier);
        bytes32 sessionId = _open(ALICE, horse, stake);
        solver.setOutcome(rawSeed % 5 + 1, rank, 30_000);
        _mine(1, 0);
        _warpToTxSec(sessionId, 30);
        uint256 payout = game.settleSession(sessionId);
        require(payout == stake * game.payoutMultipliers()[rank - 1] / 10_000, "payout formula");
        require(ALICE.balance == DEPOSIT - stake + payout, "player");
        require(vault.houseLiquidity() + payout == HOUSE + stake, "house");
        require(vault.totalLocked() + vault.houseLiquidity() == address(vault).balance, "conservation");
        require(address(vault).balance == HOUSE + stake - payout, "native payout balance");
        _assertVault();
    }

    function testFuzzForfeitConservesVault(uint8 horseSeed, uint8 tierSeed, bool solverFault) public {
        uint256 stake = game.stakeForTier(tierSeed % 4 + 1);
        bytes32 sessionId = _open(BOB, horseSeed % 5, stake);
        if (solverFault) {
            _mine(1, 0);
            vm.warp(vm.getBlockTimestamp() + 1 days);
            solver.setSolveReverts(true);
            game.forfeitSession(sessionId);
        } else {
            _forfeitLost(sessionId);
        }
        require(BOB.balance == DEPOSIT - stake, "player");
        require(vault.houseLiquidity() == HOUSE + stake && vault.reservedLiquidity() == 0, "house");
        require(address(vault).balance == HOUSE + stake, "native forfeit balance");
        _assertVault();
    }
}
