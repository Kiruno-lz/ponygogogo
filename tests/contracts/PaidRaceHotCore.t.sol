// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidRaceSolver} from "../../contracts/PaidRaceSolver.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidRaceVectorBase} from "./PaidRaceVectorBase.sol";

interface ColdVm {
    function cool(address target) external;
    function getNonce(address target) external view returns (uint64);
}

/// @dev Read-only gas probe for RPC state overrides; no transactions or deployed remote contracts are needed.
contract PaidSolveGasProbe {
    function measure(address solver, bytes calldata data) external view returns (uint256 used, bytes32 resultHash) {
        uint256 before = gasleft();
        (bool ok, bytes memory result) = solver.staticcall(data);
        used = before - gasleft();
        require(ok, "solve reverted");
        resultHash = keccak256(result);
    }
}

/// @notice Fixed production workload for the hot-core boundary. This is a regression budget, not a worst-case proof.
contract PaidRaceHotCoreTest is PaidRaceVectorBase {
    event log_named_uint(string key, uint256 val);
    event log_named_bytes32(string key, bytes32 val);
    event log_named_address(string key, address val);
    event log_named_bytes(string key, bytes val);

    function testSolverHasNoSeparatelyDeployedSupport() public {
        PaidRaceSolver solver = new PaidRaceSolver();
        require(ColdVm(address(vm)).getNonce(address(solver)) == 1, "solver created an external component");
        (bool ok,) = address(solver).staticcall(abi.encodeWithSignature("support()"));
        require(!ok, "obsolete support getter remains");
    }

    /// @dev The deployed Solver requires a roster, so the production workload runs with `DEFAULT_ROSTER`
    /// ([0,1,2,3,4] in `src/chain/paidCalls.ts`) and therefore with pony abilities on, like a real settlement.
    function _productionInput(PaidRaceEngine.CoreInput memory core, uint256 index)
        internal
        pure
        returns (IPaidRaceSolver.RaceInput memory input)
    {
        input = _derivedRaceInput(core, index);
        input.roster = [uint8(0), 1, 2, 3, 4];
    }

    /// @dev Explicit-profile adversarial fixture: diagnostic kernel gas, separate from production solve gas.
    function solveDiagnostic(PaidRaceEngine.CoreInput calldata input)
        external
        pure
        returns (PaidRaceEngine.Result memory)
    {
        return PaidRaceEngine.solve(input, PaidRaceEngine.Options(0, false, 0, false));
    }

    /// @notice Export the single Solver runtime and exactly the production inputs used by the cold benchmark.
    function testExportMonadProbe() public {
        PaidRaceSolver solver = new PaidRaceSolver();
        PaidSolveGasProbe probe = new PaidSolveGasProbe();
        emit log_named_bytes32("ruleset hash", solver.rulesetHash());
        emit log_named_address("solver address", address(solver));
        emit log_named_address("probe address", address(probe));
        emit log_named_address("diagnostic address", address(this));
        emit log_named_bytes("solver code", address(solver).code);
        emit log_named_bytes("probe code", address(probe).code);
        emit log_named_bytes("diagnostic code", address(this).code);
        string[] memory cases = _cases();
        uint256 count;
        bool adversarial;
        for (uint256 i; i < cases.length; ++i) {
            string memory name = vm.parseJsonString(cases[i], ".name");
            if (_eq(name, "worst-gas-adversarial-climb")) {
                PaidRaceEngine.CoreInput memory core = _input(cases[i]);
                emit log_named_bytes("input adversarial", abi.encodeCall(this.solveDiagnostic, (core)));
                emit log_named_bytes32("expected adversarial", keccak256(abi.encode(this.solveDiagnostic(core))));
                adversarial = true;
            }
            if (!_eq(name, string.concat("derived-", _itoa(count)))) continue;
            IPaidRaceSolver.RaceInput memory input = _productionInput(_input(cases[i]), count);
            bytes memory data = abi.encodeCall(IPaidRaceSolver.solve, (input));
            emit log_named_bytes(string.concat("input ", name), data);
            emit log_named_bytes32(string.concat("expected ", name), keccak256(abi.encode(solver.solve(input))));
            ++count;
        }
        require(count == 80, "80 production inputs required");
        require(adversarial, "adversarial input required");
    }

    function measure(PaidRaceSolver solver, IPaidRaceSolver.RaceInput calldata input)
        external
        returns (uint256 used, bytes32 resultHash)
    {
        ColdVm(address(vm)).cool(address(solver));
        uint256 before = gasleft();
        IPaidRaceSolver.RaceResult memory result = solver.solve(input);
        used = before - gasleft();
        resultHash = keccak256(abi.encode(result));
    }

    function testColdProductionWorkload() public {
        PaidRaceSolver solver = new PaidRaceSolver();
        string[] memory cases = _cases();
        uint256 count;
        uint256 total;
        uint256 maximum;
        for (uint256 i; i < cases.length; ++i) {
            string memory name = vm.parseJsonString(cases[i], ".name");
            if (!_eq(name, string.concat("derived-", _itoa(count)))) continue;
            (uint256 used, bytes32 hash) = this.measure(solver, _productionInput(_input(cases[i]), count));
            emit log_named_uint(string.concat("cold gas ", name), used);
            emit log_named_bytes32(string.concat("result ", name), hash);
            total += used;
            if (used > maximum) maximum = used;
            ++count;
        }
        require(count == 80, "80 production inputs required");
        emit log_named_uint("cold mean", total / count);
        emit log_named_uint("cold maximum", maximum);
        require(total / count < 4_000_000 && maximum < 8_000_000, "hot-core boundary regressed");
    }
}
