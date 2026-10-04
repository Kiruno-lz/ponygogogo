// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PonyGameBase, VmLog} from "./PonyGameBase.sol";
import {PonyGame} from "../../contracts/PonyGame.sol";
import {RewardRules} from "../../contracts/libraries/RewardRules.sol";

/// @dev A player contract whose payout callback burns every unit of gas it is forwarded down to `floorGas`.
/// `PonyVault.settleStake` pays with an uncapped `call`, so this callback runs inside `settleSession` right
/// before the post-payout `gasleft() < RewardRules.GAS_RESERVE` check.
contract GasBurningPlayer {
    uint256 public received;
    /// @dev Leaves enough for the Vault to finish its solvency check and both events, and nothing more.
    uint256 public floorGas = 80_000;

    receive() external payable {
        received += msg.value;
        uint256 floor_ = floorGas;
        while (gasleft() > floor_) {}
    }

    function setFloorGas(uint256 value) external {
        floorGas = value;
    }
}

contract PonyGameRewardsTest is PonyGameBase {
    function winningParent(bytes32 sessionId) private returns (uint8 expectedKind, uint8 expectedId) {
        for (uint256 i = 1;; ++i) {
            bytes32 parent = bytes32(i);
            bytes32 seed = keccak256(abi.encode(parent, block.chainid, address(game), sessionId, ALICE));
            (bool grant, uint8 kind, uint8 id) = RewardRules.draw(seed, 0);
            if (grant) {
                vm.setBlockhash(block.number - 1, parent);
                return (kind, id);
            }
        }
    }

    function testSettlementParentDrawRecordsSameTransaction() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        solver.setOutcome(1, 1, 1000);
        _mine(1, 1);
        (uint8 expectedKind, uint8 expectedId) = winningParent(sessionId);
        uint256 payout = game.settleSession(sessionId);
        require(payout == 0.9 ether, "payout");
        uint256 bit = expectedKind == 0 ? expectedId : uint256(64) + expectedId;
        require(rewards.ownedMask(ALICE) == uint256(1) << bit, "settled without draw");
        require(rewards.recorded(sessionId), "session not recorded");
    }

    function testLedgerFailureStillSettlesAndPays() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        solver.setOutcome(1, 1, 1000);
        _mine(1, 1);
        winningParent(sessionId);
        rewards.setGame(address(game), false);
        vm.recordLogs();
        require(game.settleSession(sessionId) == 0.9 ether, "lost payout");
        require(game.getSession(sessionId).state == 2, "not settled");
        require(rewards.ownedMask(ALICE) == 0, "invalid grant");
        VmLog[] memory logs = vm.getRecordedLogs();
        bool skipped;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(game) && logs[i].topics[0] == keccak256("CollectibleSkipped(bytes32)")) {
                skipped = true;
            }
        }
        require(skipped, "missing skip event");
    }

    function testInsufficientRewardGasRejectsWithoutClosingSession() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        solver.setOutcome(1, 1, 1000);
        _mine(1, 1);
        (bool ok, bytes memory err) = address(game).call{gas: 180000}(abi.encodeCall(game.settleSession, (sessionId)));
        require(!ok && bytes4(err) == PonyGame.InsufficientRewardGas.selector, "gas reserve");
        require(game.getSession(sessionId).state == 1, "closed low-gas session");
        game.settleSession(sessionId);
        require(game.getSession(sessionId).state == 2, "cannot retry");
    }

    /// @notice The reserve sits in front of `_grantCollectible`, so an underfunded keeper can only revert the
    /// settlement, never land one that silently skipped the draw. Walks the budget up from the reserve: every
    /// refusal must be `InsufficientRewardGas` with the session untouched, and the first settle that lands must
    /// carry the grant. A failed call reverts its own state, so no snapshot is needed between probes.
    function testLowKeeperGasRevertsInsteadOfSkippingTheGrant() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        solver.setOutcome(1, 1, 1000);
        _mine(1, 1);
        (uint8 expectedKind, uint8 expectedId) = winningParent(sessionId);
        uint256 bit = expectedKind == 0 ? expectedId : uint256(64) + expectedId;

        bool settled;
        for (uint256 budget = RewardRules.GAS_RESERVE; budget <= 4 * RewardRules.GAS_RESERVE; budget += 12_500) {
            (bool ok, bytes memory err) =
                address(game).call{gas: budget}(abi.encodeCall(game.settleSession, (sessionId)));
            if (ok) {
                settled = true;
                break;
            }
            require(bytes4(err) == PonyGame.InsufficientRewardGas.selector, "refused by plain out-of-gas");
            require(game.getSession(sessionId).state == 1, "closed an underfunded session");
            require(rewards.ownedMask(ALICE) == 0 && !rewards.recorded(sessionId), "granted on a reverted settle");
        }
        require(settled, "no budget settled");
        require(rewards.ownedMask(ALICE) == uint256(1) << bit, "settled without the grant");
        require(rewards.recorded(sessionId), "session not recorded");
        require(game.getSession(sessionId).state == 2, "not settled");
    }

    /// @notice D3 reproduction. `settleSession` pays the player through `vault.settleStake` and only then checks
    /// `gasleft() < RewardRules.GAS_RESERVE` and grants the collectible. The payout is an uncapped `call`, so the
    /// player's own `receive()` decides how much gas survives into that check. A player must not be able to make
    /// a valid settlement revert — the settlement is permissionless and the stake stays locked until it lands.
    /// @dev The settle runs with four times an honest settlement's gas and still far below `64 * GAS_RESERVE`,
    /// which is where EIP-150's 1/64 retention would mask the hazard on its own.
    function testGasBurningReceiveCannotBlockAValidSettlement() public {
        GasBurningPlayer attacker = new GasBurningPlayer();
        vm.deal(address(attacker), DEPOSIT);

        bytes32 baselineId = _open(BOB, 0, TIER1);
        solver.setOutcome(1, 1, 1000);
        _mine(1, 1);
        uint256 before = gasleft();
        require(game.settleSession(baselineId) == 0.9 ether, "baseline payout");
        uint256 honest = before - gasleft();

        bytes32 sessionId = _open(address(attacker), 0, TIER1);
        solver.setOutcome(1, 1, 1000);
        _mine(1, 1);
        uint256 budget = honest * 4;
        require(budget > honest && budget < 64 * RewardRules.GAS_RESERVE, "budget masks the hazard");
        (bool ok, bytes memory err) = address(game).call{gas: budget}(abi.encodeCall(game.settleSession, (sessionId)));
        require(
            ok,
            string.concat(
                "a gas-burning receive() blocked a valid settlement (budget ",
                _itoa(budget),
                ", honest ",
                _itoa(honest),
                ", revert 0x",
                _hex4(bytes4(err)),
                ")"
            )
        );
        require(game.getSession(sessionId).state == 2, "session left open");
        require(attacker.received() == 0.9 ether, "payout withheld");
        require(game.sessionOf(address(attacker)) == bytes32(0), "session still current");
    }

    function _itoa(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        bytes memory out = new bytes(78);
        uint256 n;
        while (value != 0) {
            out[n++] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        bytes memory rev = new bytes(n);
        for (uint256 i; i < n; ++i) {
            rev[i] = out[n - 1 - i];
        }
        return string(rev);
    }

    function _hex4(bytes4 value) private pure returns (string memory) {
        bytes memory digits = "0123456789abcdef";
        bytes memory out = new bytes(8);
        for (uint256 i; i < 4; ++i) {
            out[2 * i] = digits[uint8(value[i]) >> 4];
            out[2 * i + 1] = digits[uint8(value[i]) & 0xf];
        }
        return string(out);
    }

    function testForfeitNeverGrantsCollectibles() public {
        bytes32 sessionId = _open(ALICE, 0, TIER1);
        _mine(1, 1);
        _jump(9000, 3000);
        game.forfeitSession(sessionId);
        require(rewards.ownedMask(ALICE) == 0 && !rewards.recorded(sessionId), "forfeit granted");
    }
}
