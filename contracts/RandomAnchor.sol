// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Reads canonical block hashes the EVM can still verify: BLOCKHASH for 256 blocks, then the EIP-2935
/// history contract for 8191 blocks (about 47 minutes on Monad), never a caller-supplied hash.
library RandomAnchor {
    error AnchorUnavailable();

    /// @dev EIP-2935 history storage contract (same address on Monad Testnet).
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint256 internal constant DIRECT_WINDOW = 256;
    uint256 internal constant HISTORY_WINDOW = 8191;

    function read(uint256 blockNumber) internal view returns (bytes32 hash) {
        bool ok;
        (ok, hash) = tryRead(blockNumber);
        if (!ok) revert AnchorUnavailable();
    }

    /// @notice Non-reverting read. `ok` is false for the current or a future block, outside both windows, when the
    /// history contract is absent or refuses, and for a zero hash.
    function tryRead(uint256 blockNumber) internal view returns (bool ok, bytes32 hash) {
        if (blockNumber >= block.number) return (false, bytes32(0));
        uint256 age = block.number - blockNumber;
        if (age <= DIRECT_WINDOW) hash = blockhash(blockNumber);
        if (hash == bytes32(0) && age <= HISTORY_WINDOW && HISTORY.code.length != 0) {
            // The getter takes exactly 32 bytes (big-endian block number) and returns the 32-byte hash.
            (bool success, bytes memory data) = HISTORY.staticcall(abi.encode(blockNumber));
            if (success && data.length == 32) hash = abi.decode(data, (bytes32));
        }
        ok = hash != bytes32(0);
    }

    /// @notice True only once `blockNumber` is in the past and its hash can no longer be read. Readability never
    /// returns for such a block: both windows only move forward.
    /// @dev A caller cannot starve the history staticcall to fake a loss: the getter needs a few thousand gas while
    /// the 63/64 rule leaves it far more whenever the caller can still afford the refund that follows.
    function isLost(uint256 blockNumber) internal view returns (bool) {
        if (blockNumber >= block.number) return false;
        (bool ok,) = tryRead(blockNumber);
        return !ok;
    }
}
