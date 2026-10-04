// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Persistent collectible ledger. Registered Game versions define their own candidate tables.
contract PonyRewards is Ownable2Step {
    error UnregisteredGame();
    error InvalidCollectible();
    error DuplicateSession();
    error AlreadyOwned();
    mapping(address => bool) public games;
    mapping(address => uint256) public ownedMask;
    mapping(bytes32 => bool) public recorded;
    event GameRegistered(address indexed game, bool enabled);
    event CollectibleGranted(bytes32 indexed sessionId, address indexed player, uint8 assetKind, uint8 assetId);

    constructor(address owner_) Ownable(owner_) {}

    function setGame(address game, bool enabled) external onlyOwner {
        if (game == address(0)) revert UnregisteredGame();
        games[game] = enabled;
        emit GameRegistered(game, enabled);
    }

    function record(bytes32 sessionId, address player, uint8 assetKind, uint8 assetId) external {
        if (!games[msg.sender]) revert UnregisteredGame();
        if (
            sessionId == bytes32(0) || player == address(0) || assetKind > 1
                || (assetKind == 0 && (assetId == 0 || assetId >= 64))
                || (assetKind == 1 && (assetId < 5 || assetId > 191))
        ) revert InvalidCollectible();
        if (recorded[sessionId]) revert DuplicateSession();
        uint256 bit = uint256(1) << (assetKind == 0 ? assetId : uint256(64) + assetId);
        if (ownedMask[player] & bit != 0) revert AlreadyOwned();
        recorded[sessionId] = true;
        ownedMask[player] |= bit;
        emit CollectibleGranted(sessionId, player, assetKind, assetId);
    }
}
