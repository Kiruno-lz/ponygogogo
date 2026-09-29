// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentBudget} from "../../contracts/AgentBudget.sol";

interface VmTime {
    function warp(uint256 timestamp) external;
}

contract BudgetHarness is AgentBudget {
    function configure(uint64 expiry, uint256 maxStake) external {
        _configureAgentBudget(msg.sender, expiry, maxStake);
    }

    function consume(uint256 stake) external {
        _consumeAgentBudget(msg.sender, stake);
    }

    function revoke() external {
        _revokeAgentBudget(msg.sender);
    }
}

contract AgentBudgetTest {
    VmTime constant vm = VmTime(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testCumulativeCapExpiryAndRevocation() public {
        BudgetHarness budget = new BudgetHarness();
        budget.configure(uint64(block.timestamp + 100), 5 ether);
        budget.consume(2 ether);
        budget.consume(3 ether);
        (uint64 expiry, uint256 maximum, uint256 spent) = budget.agentBudgets(address(this));
        require(expiry == block.timestamp + 100 && maximum == 5 ether && spent == 5 ether, "spent");
        (bool extra,) = address(budget).call(abi.encodeCall(BudgetHarness.consume, (1)));
        require(!extra, "cap bypass");
        budget.revoke();
        (bool revoked,) = address(budget).call(abi.encodeCall(BudgetHarness.consume, (1)));
        require(!revoked, "revocation bypass");
    }

    function testExpiredOrZeroBudgetRejectsSpend() public {
        BudgetHarness budget = new BudgetHarness();
        (bool missing,) = address(budget).call(abi.encodeCall(BudgetHarness.consume, (1)));
        require(!missing, "missing budget");
        (bool invalid,) =
            address(budget).call(abi.encodeCall(BudgetHarness.configure, (uint64(block.timestamp), 5 ether)));
        require(!invalid, "past deadline accepted");
        uint64 expiry = uint64(block.timestamp + 1);
        budget.configure(expiry, 5 ether);
        vm.warp(expiry);
        (bool expired,) = address(budget).call(abi.encodeCall(BudgetHarness.consume, (1)));
        require(!expired, "expired budget");
    }
}
