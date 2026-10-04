// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PonyRewards} from "../../contracts/PonyRewards.sol";
import {RewardRules} from "../../contracts/libraries/RewardRules.sol";
import {PonyVm} from "./PonyGameBase.sol";

contract RewardRulesHarness {
    function at(uint256 roll, uint256 pick, uint256 owned) external pure returns (bool, uint8, uint8) {
        return RewardRules.atRoll(roll, pick, owned);
    }
}

contract PonyRewardsTest {
    PonyVm internal constant vm = PonyVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    PonyRewards internal rewards;
    address internal constant PLAYER = address(0xA11CE);

    function setUp() public {
        rewards = new PonyRewards(address(this));
        rewards.setGame(address(this), true);
    }

    function testRecordBothKindsRejectDuplicateAndUnauthorized() public {
        rewards.record(bytes32(uint256(1)), PLAYER, 0, 2);
        rewards.record(bytes32(uint256(2)), PLAYER, 1, 8);
        require(rewards.ownedMask(PLAYER) == (uint256(1) << 2) | (uint256(1) << 72), "mask");
        vm.expectRevert(PonyRewards.DuplicateSession.selector);
        rewards.record(bytes32(uint256(1)), PLAYER, 0, 18);
        vm.expectRevert(PonyRewards.AlreadyOwned.selector);
        rewards.record(bytes32(uint256(3)), PLAYER, 1, 8);
        vm.prank(address(0xBAD));
        vm.expectRevert(PonyRewards.UnregisteredGame.selector);
        rewards.record(bytes32(uint256(4)), PLAYER, 0, 18);
    }

    function testLedgerSurvivesGameRotation() public {
        rewards.record(bytes32(uint256(1)), PLAYER, 0, 2);
        rewards.setGame(address(0xB0B), true);
        rewards.setGame(address(this), false);
        vm.prank(address(0xB0B));
        rewards.record(bytes32(uint256(2)), PLAYER, 1, 5);
        require(rewards.ownedMask(PLAYER) == (uint256(1) << 2) | (uint256(1) << 69), "rotation lost progress");
    }

    function testExactChanceAndWeightedBoundary() public {
        RewardRulesHarness h = new RewardRulesHarness();
        (bool granted, uint8 kind, uint8 id) = h.at(1999, 0, 0);
        require(granted && kind == 0 && id == 2, "first");
        (granted,,) = h.at(2000, 0, 0);
        require(!granted, "chance cutoff");
        (granted, kind, id) = h.at(0, 25, 0);
        require(granted && kind == 1 && id == 5, "pony weight");
        (granted,,) = h.at(0, 0, type(uint256).max);
        require(!granted, "all owned");
    }
}
