// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Game-only native MON stake custody, payout reserves and direct player payments.
contract PonyVault is Ownable2Step, ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedGame();
    error EntryPaused();
    error InsufficientHouseLiquidity();
    error InvalidLock();
    error ExcessPayout();
    error NativeTransferFailed();
    error Insolvent();

    struct StakeLock {
        address player;
        uint256 stake;
        uint256 maxPayout;
        uint256 reserve;
        // 0 = absent, 1 = locked, 2 = settled (a forfeit settles with payout 0). There are no refunds.
        uint8 state;
    }

    address public immutable game;
    bool public entryPaused;
    mapping(bytes32 => StakeLock) public stakeLocks;
    uint256 public totalLocked;
    uint256 public houseLiquidity;
    uint256 public reservedLiquidity;

    event HouseFunded(address indexed funder, uint256 amount);
    event HouseWithdrawn(address indexed recipient, uint256 amount);
    event EntryPauseChanged(bool paused);
    event StakeLocked(
        bytes32 indexed sessionId, address indexed player, uint256 stake, uint256 maxPayout, uint256 reserve
    );
    event StakeSettled(bytes32 indexed sessionId, address indexed player, uint256 payout);

    constructor(address game_, address owner_) Ownable(owner_) {
        if (game_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        game = game_;
    }

    modifier onlyGame() {
        if (msg.sender != game) revert UnauthorizedGame();
        _;
    }

    function setEntryPaused(bool paused) external onlyOwner {
        entryPaused = paused;
        emit EntryPauseChanged(paused);
    }

    function withdrawableHouse() public view returns (uint256) {
        return houseLiquidity - reservedLiquidity;
    }

    function fundHouse() external payable onlyOwner nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        houseLiquidity += msg.value;
        _assertSolvent();
        emit HouseFunded(msg.sender, msg.value);
    }

    function withdrawHouse(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > withdrawableHouse()) revert InsufficientHouseLiquidity();
        houseLiquidity -= amount;
        _sendNative(msg.sender, amount);
        _assertSolvent();
        emit HouseWithdrawn(msg.sender, amount);
    }

    function lockStake(bytes32 sessionId, address player, uint256 stake, uint256 maxPayout)
        external
        payable
        onlyGame
        nonReentrant
    {
        if (entryPaused) revert EntryPaused();
        if (
            sessionId == bytes32(0) || player == address(0) || stake == 0 || msg.value != stake
                || stakeLocks[sessionId].state != 0
        ) {
            revert InvalidLock();
        }
        uint256 reserve = maxPayout > stake ? maxPayout - stake : 0;
        if (reserve > withdrawableHouse()) revert InsufficientHouseLiquidity();
        totalLocked += stake;
        reservedLiquidity += reserve;
        stakeLocks[sessionId] = StakeLock(player, stake, maxPayout, reserve, 1);
        _assertSolvent();
        emit StakeLocked(sessionId, player, stake, maxPayout, reserve);
    }

    function settleStake(bytes32 sessionId, uint256 payout) external onlyGame nonReentrant returns (uint256 paid) {
        StakeLock storage lock = stakeLocks[sessionId];
        if (lock.state != 1) revert InvalidLock();
        if (payout > lock.maxPayout) revert ExcessPayout();
        lock.state = 2;
        totalLocked -= lock.stake;
        reservedLiquidity -= lock.reserve;
        if (payout > lock.stake) {
            houseLiquidity -= payout - lock.stake;
        } else {
            houseLiquidity += lock.stake - payout;
        }
        paid = payout;
        if (payout != 0) {
            (bool sent,) = lock.player.call{value: payout}("");
            if (!sent) {
                houseLiquidity += payout;
                paid = 0;
            }
        }
        _assertSolvent();
        emit StakeSettled(sessionId, lock.player, paid);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    function _assertSolvent() private view {
        if (houseLiquidity < reservedLiquidity || address(this).balance < totalLocked + houseLiquidity) {
            revert Insolvent();
        }
    }
}
