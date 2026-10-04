// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidCardRules} from "../contracts/libraries/PaidCardRules.sol";
import {PonyGame} from "../contracts/PonyGame.sol";
import {PonyVault} from "../contracts/PonyVault.sol";
import {PonyRewards} from "../contracts/PonyRewards.sol";

/// @dev The subset of Foundry script cheatcodes used here (the repo has no forge-std).
interface DeployVm {
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function envString(string calldata name) external view returns (string memory);
    function readFile(string calldata path) external view returns (string memory);
    function trim(string calldata input) external pure returns (string memory);
    function parseUint(string calldata input) external pure returns (uint256);
    function addr(uint256 privateKey) external pure returns (address);
    function getCode(string calldata artifactPath) external view returns (bytes memory);
    function toString(bytes32 value) external pure returns (string memory);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the single Solver (or reuses PONY_SOLVER), PonyGame and PonyVault; binds them; optionally funds
/// the house and opens entry. Solver's hot core and cold-path libraries are compiled into its artifact.
/// @dev Environment:
///   DEPLOYER_PRIVATE_KEY_PATH  file holding the 0x-prefixed deployer key (read via vm.readFile, never logged;
///                              foundry.toml grants read access to ./keys only)
///   PONY_SOLVER                existing IPaidRaceSolver; unset deploys the PaidRaceSolver artifact (no constructor
///                              arguments)
///   HOUSE_FUND_WEI             house liquidity to deposit, default 0
///   UNPAUSE                    1 opens entry after deployment, default paused
/// Usage (simulate, then broadcast):
///   forge script scripts/DeployPony.s.sol --rpc-url "$ETH_RPC_URL"
///   forge script scripts/DeployPony.s.sol --rpc-url "$ETH_RPC_URL" --broadcast
contract DeployPony {
    DeployVm internal constant vm = DeployVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    address internal constant CONSOLE = 0x000000000000000000636F6e736F6c652e6c6f67;

    error MissingSolver();
    error DeploymentFailed();
    error RulesetMismatch();
    error InvalidDeployerKey();

    function run() external returns (IPaidRaceSolver solver, PonyGame game, PonyVault vault) {
        uint256 key = _deployerKey();
        address deployer = vm.addr(key);
        address solverAddress = vm.envOr("PONY_SOLVER", address(0));
        uint256 houseFund = vm.envOr("HOUSE_FUND_WEI", uint256(0));
        bool unpause = vm.envOr("UNPAUSE", uint256(0)) == 1;
        address rewardsAddress = vm.envOr("PONY_REWARDS", address(0));
        bytes memory solverCode;
        if (solverAddress == address(0)) {
            try vm.getCode("PaidRaceSolver.sol:PaidRaceSolver") returns (bytes memory code) {
                solverCode = code;
            } catch {
                revert MissingSolver();
            }
        } else if (IPaidRaceSolver(solverAddress).rulesetHash() != PaidCardRules.RULESET_HASH) {
            revert RulesetMismatch();
        }

        vm.startBroadcast(key);
        if (solverAddress == address(0)) solverAddress = _create(solverCode);
        solver = IPaidRaceSolver(solverAddress);
        if (solver.rulesetHash() != PaidCardRules.RULESET_HASH) revert RulesetMismatch();
        PonyRewards rewards = rewardsAddress == address(0)
            ? PonyRewards(_create(abi.encodePacked(vm.getCode("PonyRewards.sol:PonyRewards"), abi.encode(deployer))))
            : PonyRewards(rewardsAddress);
        game = PonyGame(_create(abi.encodePacked(vm.getCode("PonyGame.sol:PonyGame"), abi.encode(deployer, solver, rewards))));
        rewards.setGame(address(game), true);
        vault = PonyVault(payable(_create(abi.encodePacked(vm.getCode("PonyVault.sol:PonyVault"), abi.encode(address(game), deployer)))));
        game.bindVault(vault);
        if (houseFund != 0) vault.fundHouse{value: houseFund}();
        if (unpause) game.setEntryPaused(false);
        vm.stopBroadcast();

        _log("deployer", deployer);
        _log("solver", address(solver));
        _log("game", address(game));
        _log("vault", address(vault));
        _log("rewards", address(rewards));
        _log("rulesetHash", game.rulesetHash());
        _log("houseLiquidity", vault.houseLiquidity());
        _log("entryPaused", game.entryPaused() ? 1 : 0);
    }

    function _deployerKey() private view returns (uint256 key) {
        string memory raw = vm.trim(vm.readFile(vm.envString("DEPLOYER_PRIVATE_KEY_PATH")));
        bytes memory text = bytes(raw);
        if (text.length != 66 || text[0] != "0" || (text[1] != "x" && text[1] != "X")) revert InvalidDeployerKey();
        key = vm.parseUint(raw);
        if (key == 0) revert InvalidDeployerKey();
    }

    function _create(bytes memory code) private returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create(0, add(code, 0x20), mload(code))
        }
        if (deployed == address(0)) revert DeploymentFailed();
    }

    function _log(string memory label, address value) private view {
        (bool ok,) = CONSOLE.staticcall(abi.encodeWithSignature("log(string,address)", label, value));
        ok;
    }

    function _log(string memory label, uint256 value) private view {
        (bool ok,) = CONSOLE.staticcall(abi.encodeWithSignature("log(string,uint256)", label, value));
        ok;
    }

    function _log(string memory label, bytes32 value) private view {
        (bool ok,) = CONSOLE.staticcall(abi.encodeWithSignature("log(string,string)", label, vm.toString(value)));
        ok;
    }
}
