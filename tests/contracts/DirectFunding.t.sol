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

/// @dev Solidity has no constant fixed-size arrays; the default roster is built on demand.
function defaultRoster() pure returns (uint8[5] memory) {
    return [uint8(0), 1, 2, 3, 4];
}

contract FundingAccount {
    PonyGame public game;
    bytes32 public sessionId;
    bool public reject;
    bool public attack;
    bool public reentered;

    function open(PonyGame game_) external {
        game = game_;
        sessionId = game_.openSession{value: 0.3 ether}(0, 0.3 ether, defaultRoster());
    }

    function configure(bool reject_, bool attack_) external {
        reject = reject_;
        attack = attack_;
    }

    receive() external payable {
        require(!reject, "declined payout");
        if (attack) {
            (reentered,) =
                address(game).call{value: 0.3 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
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
            address(game).call{value: 0.3 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
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
        (bool mismatch,) =
            address(game).call{value: 0.2 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
        require(!mismatch, "value mismatch accepted");
        vault.setEntryPaused(true);
        (bool paused,) =
            address(game).call{value: 0.3 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
        require(!paused && game.nonces(address(this)) == 0 && game.sessionOf(address(this)) == 0, "partial open");
        require(
            address(this).balance == before_ && address(game).balance == 0 && address(vault).balance == 50 ether,
            "partial transfer"
        );
    }

    /// @notice Direct funding × roster cross cases (plan §4.3 item 4). Each axis must reject on its own: a legal
    /// roster does not excuse a wrong `msg.value`, and the exact stake does not excuse an illegal roster. Neither
    /// may lock a stake in the Vault nor advance the opener's nonce.
    function testDirectFundingAndRosterRejectIndependently() public {
        uint256 callerBefore = address(this).balance;
        uint256 vaultBefore = address(vault).balance;

        // Valid roster, wrong value — both directions.
        (bool under, bytes memory underData) =
            address(game).call{value: 0.2 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
        require(!under && bytes4(underData) == PonyGame.StakeValueMismatch.selector, "underpaid stake accepted");
        (bool over, bytes memory overData) =
            address(game).call{value: 0.4 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
        require(!over && bytes4(overData) == PonyGame.StakeValueMismatch.selector, "overpaid stake accepted");
        (bool none, bytes memory noneData) =
            address(game).call(abi.encodeCall(game.openSession, (0, 0.3 ether, defaultRoster())));
        require(!none && bytes4(noneData) == PonyGame.StakeValueMismatch.selector, "unfunded open accepted");

        // Exact value, illegal roster: a duplicate, an unknown id and the 0xff sentinel.
        uint8[5][3] memory bad = [[uint8(0), 1, 2, 3, 3], [uint8(0), 1, 2, 3, 9], [uint8(0), 1, 2, 3, 255]];
        for (uint256 i; i < bad.length; ++i) {
            (bool ok, bytes memory data) =
                address(game).call{value: 0.3 ether}(abi.encodeCall(game.openSession, (0, 0.3 ether, bad[i])));
            require(!ok && bytes4(data) == PonyGame.InvalidEntry.selector, "illegal roster accepted with exact stake");
        }
        // The same cross on the agent path, which spends budget before `_open` runs.
        game.configureAgentBudget(uint64(block.timestamp + 1 days), 1 ether);
        (bool agentValue,) =
            address(game).call{value: 0.2 ether}(abi.encodeCall(game.openAgentSession, (0, 0.3 ether, defaultRoster())));
        (bool agentRoster,) = address(game).call{value: 0.3 ether}(
            abi.encodeCall(game.openAgentSession, (0, 0.3 ether, [uint8(0), 1, 2, 3, 3]))
        );
        require(!agentValue && !agentRoster, "agent path accepted a bad value or roster");
        (,, uint256 spent) = game.agentBudgets(address(this));
        require(spent == 0, "failed agent open consumed budget");

        require(address(this).balance == callerBefore, "a rejected open kept the caller's money");
        require(address(game).balance == 0, "a rejected open left money in the Game");
        require(address(vault).balance == vaultBefore && vault.totalLocked() == 0, "a rejected open locked a stake");
        require(game.nonces(address(this)) == 0 && game.sessionOf(address(this)) == 0, "a rejected open bumped nonce");
    }
}
