// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PonyVault} from "../../contracts/PonyVault.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
}

contract VaultActor {
    receive() external payable {}

    function deposit(PonyVault vault) external payable {
        vault.deposit{value: msg.value}();
    }

    function withdraw(PonyVault vault, uint256 amount) external {
        vault.withdraw(amount);
    }

    function fund(PonyVault vault) external payable {
        vault.fundHouse{value: msg.value}();
    }

    function withdrawHouse(PonyVault vault, uint256 amount) external {
        vault.withdrawHouse(amount);
    }

    function pause(PonyVault vault, bool paused) external {
        vault.setEntryPaused(paused);
    }

    function lock(PonyVault vault, bytes32 id, address player, uint256 stake, uint256 maxPayout) external {
        vault.lockStake(id, player, stake, maxPayout);
    }

    function settle(PonyVault vault, bytes32 id, uint256 payout) external {
        vault.settleStake(id, payout);
    }

    function call(address target, bytes calldata data) external returns (bool ok, bytes memory ret) {
        return target.call(data);
    }
}

contract PonyVaultTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant UNIT = 1 ether;
    bytes32 constant SESSION = keccak256("session-1");
    PonyVault vault;
    VaultActor player;
    VaultActor house;
    VaultActor game;
    VaultActor attacker;

    function setUp() public {
        player = new VaultActor();
        house = new VaultActor();
        game = new VaultActor();
        attacker = new VaultActor();
        vault = new PonyVault(address(game), address(house));
        vm.deal(address(player), 100 * UNIT);
        vm.deal(address(house), 100 * UNIT);
    }

    function _fund() internal {
        player.deposit{value: 20 * UNIT}(vault);
        house.fund{value: 30 * UNIT}(vault);
    }

    function _assertSolvent() internal view {
        require(
            address(vault).balance >= vault.totalAvailable() + vault.totalLocked() + vault.houseLiquidity(), "insolvent"
        );
        require(vault.houseLiquidity() >= vault.reservedLiquidity(), "reserve exceeds house");
    }

    function testDepositAndWithdrawUseActualNativeBalance() public {
        player.deposit{value: 10 * UNIT}(vault);
        require(vault.available(address(player)) == 10 * UNIT, "deposit balance");
        player.withdraw(vault, 4 * UNIT);
        require(vault.available(address(player)) == 6 * UNIT, "withdraw balance");
        require(address(player).balance == 104 * UNIT, "wallet native balance");
        _assertSolvent();
    }

    function testReserveSettlementAndHouseWithdrawal() public {
        _fund();
        game.lock(vault, SESSION, address(player), 5 * UNIT, 15 * UNIT);
        require(vault.available(address(player)) == 15 * UNIT, "stake was not locked");
        require(vault.totalLocked() == 5 * UNIT, "locked total");
        require(vault.reservedLiquidity() == 10 * UNIT, "reserve");
        require(vault.withdrawableHouse() == 20 * UNIT, "withdrawable house");
        (bool blocked,) = address(house).call(abi.encodeCall(VaultActor.withdrawHouse, (vault, 21 * UNIT)));
        require(!blocked, "reserved house funds withdrawn");
        game.settle(vault, SESSION, 15 * UNIT);
        require(vault.available(address(player)) == 30 * UNIT, "payout");
        require(vault.houseLiquidity() == 20 * UNIT, "house loss");
        require(vault.reservedLiquidity() == 0, "reserve not released");
        _assertSolvent();
    }

    /// @notice A forfeit is settleStake(id, 0): the stake joins the house, the reserve is released, nothing is
    /// refunded, and the lock can never pay again. The Vault has no refund entry point.
    function testForfeitSettlesZeroOnceAndNoRefundExists() public {
        _fund();
        game.lock(vault, SESSION, address(player), 5 * UNIT, 15 * UNIT);
        (bool ok, bytes memory ret) =
            game.call(address(vault), abi.encodeWithSignature("refundStake(bytes32)", SESSION));
        require(!ok && ret.length == 0, "refundStake exists");
        game.settle(vault, SESSION, 0);
        require(vault.available(address(player)) == 15 * UNIT, "forfeited stake returned");
        require(vault.houseLiquidity() == 35 * UNIT && vault.reservedLiquidity() == 0, "stake to the house");
        (,,,, uint8 state) = vault.stakeLocks(SESSION);
        require(state == 2 && vault.totalLocked() == 0, "settled lock");
        (bool settled,) = address(game).call(abi.encodeCall(VaultActor.settle, (vault, SESSION, 15 * UNIT)));
        (bool again,) = address(game).call(abi.encodeCall(VaultActor.settle, (vault, SESSION, 0)));
        require(!settled && !again, "double settlement");
        _assertSolvent();
    }

    function testOnlyGameCanLockAndPayoutCannotExceedSnapshot() public {
        _fund();
        (bool unauthorized,) = address(attacker)
            .call(abi.encodeCall(VaultActor.lock, (vault, SESSION, address(player), 5 * UNIT, 15 * UNIT)));
        require(!unauthorized, "non-game lock");
        game.lock(vault, SESSION, address(player), 5 * UNIT, 15 * UNIT);
        (bool excessive,) = address(game).call(abi.encodeCall(VaultActor.settle, (vault, SESSION, 16 * UNIT)));
        require(!excessive, "excess payout");
        require(vault.totalLocked() == 5 * UNIT, "failed payout changed lock");
        _assertSolvent();
    }

    function testInsufficientReserveCannotLock() public {
        player.deposit{value: 20 * UNIT}(vault);
        house.fund{value: 9 * UNIT}(vault);
        (bool ok,) =
            address(game).call(abi.encodeCall(VaultActor.lock, (vault, SESSION, address(player), 5 * UNIT, 15 * UNIT)));
        require(!ok, "undercollateralized lock");
        require(vault.available(address(player)) == 20 * UNIT, "failed lock changed balance");
        _assertSolvent();
    }

    function testPauseBlocksNewLockButAllowsSettlement() public {
        _fund();
        game.lock(vault, SESSION, address(player), 5 * UNIT, 15 * UNIT);
        house.pause(vault, true);
        (bool newLock,) = address(game)
            .call(abi.encodeCall(VaultActor.lock, (vault, keccak256("session-2"), address(player), UNIT, 3 * UNIT)));
        require(!newLock, "paused game accepted lock");
        game.settle(vault, SESSION, 0);
        require(vault.available(address(player)) == 15 * UNIT && vault.houseLiquidity() == 35 * UNIT, "paused forfeit");
        _assertSolvent();
    }

    function testFinalizedSessionIdCannotBeReused() public {
        _fund();
        game.lock(vault, SESSION, address(player), 5 * UNIT, 15 * UNIT);
        game.settle(vault, SESSION, 0);
        (bool reused,) =
            address(game).call(abi.encodeCall(VaultActor.lock, (vault, SESSION, address(player), UNIT, 3 * UNIT)));
        require(!reused, "finalized ID reused");
        _assertSolvent();
    }

    function testFuzzAccountingAcrossEveryRankPayout(uint256 rawPayout) public {
        uint256 payout = rawPayout % (15 * UNIT + 1);
        _fund();
        game.lock(vault, SESSION, address(player), 5 * UNIT, 15 * UNIT);
        game.settle(vault, SESSION, payout);
        require(vault.available(address(player)) == 15 * UNIT + payout, "wrong payout balance");
        require(vault.houseLiquidity() == 35 * UNIT - payout, "wrong house balance");
        _assertSolvent();
    }
}
