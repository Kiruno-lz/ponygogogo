// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {PonyGame} from "../../contracts/PonyGame.sol";
import {PonyVault} from "../../contracts/PonyVault.sol";
import {PonyRewards} from "../../contracts/PonyRewards.sol";
import {MockPaidRaceSolver} from "./MockPaidRaceSolver.sol";

interface FundingVm {
    function deal(address, uint256) external;
    function roll(uint256) external;
    function warp(uint256) external;
    function setBlockhash(uint256, bytes32) external;
}

contract FundingAccount {
    PonyGame public game;
    bytes32 public sessionId;
    bool public reject;
    bool public attack;
    bool public reentered;

    function open(PonyGame game_) external {
        game = game_;
        sessionId = game_.openSession{value: 0.3 ether}(0, 0.3 ether);
    }

    function configure(bool reject_, bool attack_) external {
        reject = reject_;
        attack = attack_;
    }

    receive() external payable {
        require(!reject, "declined payout");
        if (attack) {
            (reentered,) = address(game).call{value: 0.3 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether)));
        }
    }
}

contract DirectFundingTest {
    FundingVm constant vm = FundingVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    PonyGame game;
    PonyVault vault;
    PonyRewards rewards;
    MockPaidRaceSolver solver;

    function setUp() public {
        vm.roll(100);
        vm.warp(1_750_000_000);
        solver = new MockPaidRaceSolver(bytes32(uint256(1)));
        rewards = new PonyRewards(address(this));
        game = new PonyGame(address(this), solver, rewards);
        rewards.setGame(address(game), true);
        vault = new PonyVault(address(game), address(this));
        game.bindVault(vault);
        vm.deal(address(this), 100 ether);
        vault.fundHouse{value: 50 ether}();
        game.setEntryPaused(false);
    }

    function testOpeningAcceptsStakeWithoutPlayerDeposit() public {
        uint256 before_ = address(vault).balance;
        (bool ok,) =
            address(game).call{value: 0.3 ether}(abi.encodeWithSignature("openSession(uint8,uint256)", 0, 0.3 ether));
        require(ok, "opening must accept stake without player deposit");
        require(
            address(game).balance == 0 && address(vault).balance == before_ + 0.3 ether,
            "stake must reach Vault in the same call"
        );
    }

    function testVaultDoesNotAcceptPlayerDeposits() public {
        (bool ok,) = address(vault).call{value: 0.3 ether}(abi.encodeWithSignature("deposit()"));
        require(!ok, "Vault must not expose player deposits");
    }

    function _account() private returns (FundingAccount account) {
        account = new FundingAccount();
        vm.deal(address(account), 1 ether);
        account.open(game);
        vm.roll(101);
        vm.setBlockhash(100, keccak256("opening"));
        vm.warp(1_750_000_060);
    }

    function testRejectingPrizeClosesSessionWithoutPayingOrLeavingReserve() public {
        FundingAccount account = _account();
        account.configure(true, false);
        uint256 paid = game.settleSession(account.sessionId());
        require(paid == 0 && address(account).balance == 0.7 ether, "rejected award paid");
        require(
            game.getSession(account.sessionId()).state == 2 && game.sessionOf(address(account)) == 0,
            "session remained open"
        );
        require(vault.totalLocked() == 0 && vault.reservedLiquidity() == 0, "reserve remained locked");
        require(
            vault.houseLiquidity() == 50.3 ether && address(vault).balance == 50.3 ether, "prize not retained by house"
        );
    }

    function testSmartAccountReceivesPrizeInSettlementAndCannotReenterOpening() public {
        FundingAccount account = _account();
        account.configure(false, true);
        require(game.settleSession(account.sessionId()) == 0.9 ether, "payout amount");
        require(address(account).balance == 1.6 ether && !account.reentered(), "payout or callback");
        require(game.sessionOf(address(account)) == 0 && game.nonces(address(account)) == 1, "callback reopened");
        (bool repeated,) = address(game).call(abi.encodeCall(game.settleSession, (account.sessionId())));
        require(!repeated && address(account).balance == 1.6 ether, "double payment");
    }

    function testWrongValueAndPausedVaultLeaveNoSessionOrMoneyInGame() public {
        uint256 before_ = address(this).balance;
        (bool mismatch,) = address(game).call{value: 0.2 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether)));
        require(!mismatch, "value mismatch accepted");
        vault.setEntryPaused(true);
        (bool paused,) = address(game).call{value: 0.3 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether)));
        require(!paused && game.nonces(address(this)) == 0 && game.sessionOf(address(this)) == 0, "partial open");
        require(
            address(this).balance == before_ && address(game).balance == 0 && address(vault).balance == 50 ether,
            "partial transfer"
        );
    }
}
