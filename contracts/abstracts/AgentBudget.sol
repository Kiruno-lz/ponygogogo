// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Account-wide spend cap for Game's agent-only entry selector.
/// @dev Alchemy function permissions cannot enforce cumulative calldata amounts.
abstract contract AgentBudget {
    error InvalidAgentBudget();
    error AgentBudgetExceeded();

    struct Budget {
        uint64 expiry;
        uint256 maxStake;
        uint256 spent;
    }

    mapping(address => Budget) public agentBudgets;

    event AgentBudgetConfigured(address indexed player, uint64 expiry, uint256 maxStake);
    event AgentBudgetRevoked(address indexed player);
    event AgentBudgetSpent(address indexed player, uint256 stake, uint256 spent);

    function _configureAgentBudget(address player, uint64 expiry, uint256 maxStake) internal {
        if (player == address(0) || expiry <= block.timestamp || maxStake == 0) revert InvalidAgentBudget();
        agentBudgets[player] = Budget(expiry, maxStake, 0);
        emit AgentBudgetConfigured(player, expiry, maxStake);
    }

    function _revokeAgentBudget(address player) internal {
        delete agentBudgets[player];
        emit AgentBudgetRevoked(player);
    }

    function _consumeAgentBudget(address player, uint256 stake) internal {
        Budget storage budget = agentBudgets[player];
        if (
            stake == 0 || budget.expiry <= block.timestamp || budget.spent > budget.maxStake
                || stake > budget.maxStake - budget.spent
        ) revert AgentBudgetExceeded();
        budget.spent += stake;
        emit AgentBudgetSpent(player, stake, budget.spent);
    }
}
