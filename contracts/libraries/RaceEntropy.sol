// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Domain-separated entropy for paid races; all inputs are onchain-verifiable.
library RaceEntropy {
    function derive(bytes32 seed, bytes32 anchor, uint8 checkpoint, bytes32 purpose, uint256 eventIndex)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(seed, anchor, checkpoint, purpose, eventIndex)));
    }
}
