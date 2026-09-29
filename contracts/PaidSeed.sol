// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Fixes a public per-account seed without accepting a player-selected seed argument.
library PaidSeed {
    bytes32 internal constant DOMAIN = keccak256("ponygogogo/session-seed/v1");

    function derive(uint256 chainId, address game, address player, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, chainId, game, player, nonce));
    }
}
