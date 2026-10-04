// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidCardRules} from "../../contracts/libraries/PaidCardRules.sol";
import {PaidCpuDeck} from "../../contracts/libraries/PaidCpuDeck.sol";
import {PaidDeck} from "../../contracts/libraries/PaidDeck.sol";
import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidRaceSolver} from "../../contracts/PaidRaceSolver.sol";
import {LegacyCoreSolverProbe} from "./LegacyCoreSolverProbe.sol";
import {FieldStretchProbe} from "./PaidRaceMotion.t.sol";
import {PaidRaceVectorAssertions} from "./PaidRaceVectorAssertions.sol";

/// @notice P3 parity: every case of tests/vectors/paid-race-v4.json through the Solidity engine, field by field and
/// digest by digest (including each checkpoint's CHOICE_INVALID reason); derived cases through the deployed solver;
/// panel stops probed with a choice at the opening second. Logs `gas <case> <engine gas>` for the gas table. A digest
/// mismatch reports the first diverging event.
contract PaidRaceSolverVectorsTest is PaidRaceVectorAssertions {
    event log_named_uint(string key, uint256 val);
    event log_named_string(string key, string val);

    uint256 internal constant CHUNKS = 6;

    function _opts(uint8 stopAt, bool logEvents) internal view returns (PaidRaceEngine.Options memory) {
        return PaidRaceEngine.Options(stopAt, false, 0, logEvents);
    }

    // ------------------------------------------------------------ harness entry points (self-calls: fresh memory)

    function runCore(PaidRaceEngine.CoreInput calldata input, PaidRaceEngine.Options calldata opts)
        external
        view
        returns (PaidRaceEngine.Result memory r, uint256 gasUsed)
    {
        uint256 before = gasleft();
        r = PaidRaceEngine.solve(input, opts);
        gasUsed = before - gasleft();
    }

    // ------------------------------------------------------------ tests

    function testVectorFileHeader() public view {
        string memory file = vm.readFile(VECTOR_FILE);
        require(
            vm.parseJsonBytes32(file, ".meta.rulesetHash") == PaidCardRules.LEGACY_RULESET_HASH, "legacy ruleset hash"
        );
        uint256 count = _cases().length;
        require(count == vm.parseJsonUint(file, ".meta.count"), "count");
        require(count >= 250, "at least 250 cases");
    }

    function testVectorsChunk0() public {
        _runChunk(0);
    }

    function testVectorsChunk1() public {
        _runChunk(1);
    }

    function testVectorsChunk2() public {
        _runChunk(2);
    }

    function testVectorsChunk3() public {
        _runChunk(3);
    }

    function testVectorsChunk4() public {
        _runChunk(4);
    }

    function testVectorsChunk5() public {
        _runChunk(5);
    }

    /// @notice Archived derived cases through the legacy core adapter: opening-anchor derivation and solve.
    function testDerivedCasesThroughSolverEven() public {
        _runDerived(0);
    }

    function testDerivedCasesThroughSolverOdd() public {
        _runDerived(1);
    }

    function _runDerived(uint256 parity) internal {
        LegacyCoreSolverProbe solver = new LegacyCoreSolverProbe();
        require(solver.rulesetHash() == PaidCardRules.LEGACY_RULESET_HASH, "rulesetHash");
        string[] memory cases = _cases();
        uint256 checked;
        uint256 maxOverhead;
        for (uint256 i; i < cases.length; ++i) {
            string memory name = vm.parseJsonString(cases[i], ".name");
            if (!_isDerived(name) || _derivedIndex(name) % 2 != parity) continue;
            uint256 overhead = this.checkDerived(solver, cases[i], name);
            if (overhead > maxOverhead) maxOverhead = overhead;
            ++checked;
        }
        require(checked == 40, "derived case count");
        require(maxOverhead <= 300_000, "wrapper overhead exceeds chunk margin");
        emit log_named_uint("max solve() overhead over the engine (derivation, ABI, call)", maxOverhead);
    }

    function checkDerived(LegacyCoreSolverProbe solver, string calldata json, string calldata name)
        external
        view
        returns (uint256 overhead)
    {
        PaidRaceEngine.CoreInput memory core = _input(json);
        IPaidRaceSolver.RaceInput memory raceInput = _derivedRaceInput(core, _derivedIndex(name));
        _requireDerivation(name, core, raceInput);
        uint256 before = gasleft();
        IPaidRaceSolver.RaceResult memory r = solver.solve(raceInput);
        uint256 solveGas = before - gasleft();
        string memory failure = _compareRaceResult(name, json, r);
        require(bytes(failure).length == 0, failure);
        (, uint256 coreGas) = this.runCore(core, _opts(0, false));
        overhead = solveGas > coreGas ? solveGas - coreGas : 0;
    }

    /// @notice The original adversarial input remains within the budget; production-compatible vectors are gated.
    function testAdversarialVectorUnderGasCap() public {
        string[] memory cases = _cases();
        for (uint256 i; i < cases.length; ++i) {
            if (!_eq(vm.parseJsonString(cases[i], ".name"), "worst-gas-adversarial-climb")) continue;
            (, uint256 g) = this.runCore(_input(cases[i]), _opts(0, false));
            emit log_named_uint("adversarial engine gas", g);
            require(g + 300_000 <= SOLVE_GAS_CAP, "adversarial solve exceeds gas cap");
            return;
        }
        revert("missing adversarial fixture");
    }

    /// @notice Refresh adds at most five full ten-second well lifetimes to the five originals and five steals.
    /// This measures the conservative projection, not a reachable race or a proof of the solve cap.
    /// The real-race chunk gates retain their independent 23.5M limit.
    function testRefreshedWellFieldWorkProjection() public {
        (uint256 field, uint256 steps,,) = new FieldStretchProbe().stretch(1, 150_000);
        require(steps == 600, "refreshed well field budget");
        emit log_named_uint("field work projection (600 one-well steps)", field);
        require(field > 0, "field work was not measured");
    }

    /// @notice 有奖规则 v4: whatever PonyGame.chooseCard stores (any second, card 0..40, 0–3 slots 0..2 with repeats,
    /// any checkpoint subset) never makes the deployed solver revert, and the result stays payable.
    /// forge-config: default.fuzz.runs = 24
    function testFuzzStoredChoicesNeverRevert(
        bytes32 seed,
        bytes32 openAnchor,
        uint8 tierSeed,
        uint8 horseSeed,
        uint32[3] memory txSec,
        uint8[3] memory card,
        uint8[3] memory slotCount,
        uint24 slotBits,
        uint8 presentMask
    ) public {
        IPaidRaceSolver.RaceInput memory input;
        input.seed = seed;
        input.openAnchor = openAnchor;
        input.stakeTier = tierSeed % 4 + 1;
        input.playerHorseId = horseSeed % 5;
        input.roster = [uint8(0), 1, 2, 3, 4];
        for (uint256 k; k < 3; ++k) {
            if ((presentMask >> k) & 1 == 0) continue;
            uint8[] memory slots = new uint8[](slotCount[k] % 4);
            for (uint256 i; i < slots.length; ++i) {
                slots[i] = uint8((slotBits >> (8 * k + 2 * i)) % 3);
            }
            // Half the seconds near the canonical window of checkpoint k+1, half anywhere in uint32.
            uint32 second = txSec[k] % 2 == 0 ? uint32(15 + 20 * k + txSec[k] % 40) : txSec[k];
            input.choices[k] =
                IPaidRaceSolver.ChoiceInput(true, second, card[k] % 41, slots, keccak256(abi.encode(seed, k)));
        }
        PaidRaceSolver solver = new PaidRaceSolver();
        IPaidRaceSolver.RaceResult memory r = solver.solve(input);
        uint8 rank = r.playerSettlementRank;
        require(rank >= 1 && rank <= 5 && r.settlementOrder[rank - 1] == input.playerHorseId, "unpayable result");
        require(r.finishWall[input.playerHorseId] != 0, "player finishWall");
        require(!input.choices[0].present || r.acquired[0] == 0 || r.acquired[0] == input.choices[0].cardId, "cp1");
    }

    // ------------------------------------------------------------ chunk driver

    function _runChunk(uint256 chunk) internal {
        string[] memory cases = _cases();
        uint256 per = (cases.length + CHUNKS - 1) / CHUNKS;
        uint256 end = (chunk + 1) * per;
        if (end > cases.length) end = cases.length;
        string memory failures;
        uint256 failed;
        for (uint256 i = chunk * per; i < end; ++i) {
            (string memory failure, uint256 gasUsed, string memory name) = this.checkCase(cases[i]);
            emit log_named_uint(string.concat("gas ", name), gasUsed);
            if (_productionCore(_input(cases[i]))) {
                require(gasUsed + 300_000 <= SOLVE_GAS_CAP, string.concat(name, ": gas cap"));
            }
            if (bytes(failure).length != 0) {
                failures = string.concat(failures, "\n", failure);
                ++failed;
            }
        }
        require(failed == 0, failures);
    }

    /// @dev Controlled fixtures deliberately put player-only cards on CPUs and allow synthetic profiles.
    /// Those remain parity tests; the settlement gas gate covers the superset of cores derivable by production.
    function _productionCore(PaidRaceEngine.CoreInput memory input) private pure returns (bool) {
        for (uint256 h; h < 5; ++h) {
            PaidProfiles.Profile memory p = input.profiles[h];
            if (
                p.base < 1120 || p.base > 1420 || p.acceleration < 10 || p.acceleration > 16 || p.cap < 1700
                    || p.cap > 2080
            ) return false;
            if (h == input.playerHorseId) continue;
            for (uint256 k; k < 3; ++k) {
                if ((PaidCardRules.CPU_MASK >> (input.cpuDecks[h][k] - 1)) & 1 == 0) return false;
            }
        }
        return true;
    }

    function checkCase(string calldata json)
        external
        view
        returns (string memory failure, uint256 gasUsed, string memory name)
    {
        name = vm.parseJsonString(json, ".name");
        PaidRaceEngine.CoreInput memory input = _input(json);
        uint8 stopAt = vm.keyExistsJson(json, ".stopAtPanel") ? uint8(vm.parseJsonUint(json, ".stopAtPanel")) : 0;
        PaidRaceEngine.Options memory opts = _opts(stopAt, false);
        PaidRaceEngine.Result memory r;
        try this.runCore(input, opts) returns (PaidRaceEngine.Result memory res, uint256 g) {
            r = res;
            gasUsed = g;
        } catch (bytes memory err) {
            return (string.concat(name, ": engine reverted ", _selector(err)), 0, name);
        }
        failure = stopAt == 0 ? _compareRace(name, json, r) : _comparePanel(name, json, r);
        if (
            r.digest != vm.parseJsonBytes32(json, ".expected.digest")
                || r.eventCount != vm.parseJsonUint(json, ".expected.eventCount")
        ) {
            failure = string.concat(failure, " | ", _firstDivergence(json, input, stopAt));
        }
        if (bytes(failure).length == 0 && stopAt != 0) failure = _probePanel(name, json, r);
    }

    // ------------------------------------------------------------ comparisons

    function _probePanel(string memory name, string memory json, PaidRaceEngine.Result memory r)
        internal
        view
        returns (string memory f)
    {
        if (!r.hasPanel) return "";
        uint8 k = uint8(r.panel.checkpoint);
        uint256 expected = r.panel.mode == PaidRaceEngine.MODE_MANUAL
            ? 0
            : r.panel.mode == PaidRaceEngine.MODE_AUTO ? PaidRaceEngine.INVALID_AUTO : PaidRaceEngine.INVALID_CUT;
        uint256 openSec = r.panel.mode == PaidRaceEngine.MODE_CUT ? 0 : r.panel.openSec;
        f = _probeChoice(f, json, k, openSec, expected, "at openSec");
        if (r.panel.mode == PaidRaceEngine.MODE_MANUAL && openSec > 0) {
            f = _probeChoice(f, json, k, openSec - 1, PaidRaceEngine.INVALID_EARLY, "one second early");
        }
        if (bytes(f).length != 0) f = string.concat(name, ":", f);
    }

    function _probeChoice(
        string memory f,
        string memory json,
        uint8 k,
        uint256 txSec,
        uint256 expected,
        string memory label
    ) internal view returns (string memory) {
        PaidRaceEngine.CoreInput memory probe = _prefix(json, k);
        probe.choices[k - 1] = IPaidRaceSolver.ChoiceInput(true, uint32(txSec), 0, new uint8[](0), keccak256("probe"));
        try this.runCore(probe, _opts(0, false)) returns (PaidRaceEngine.Result memory res, uint256) {
            f = _cmp(
                f,
                string.concat("probe cp", _itoa(k), " ", label, " invalidReason"),
                expected,
                res.checkpoints[k - 1].invalidReason
            );
        } catch (bytes memory err) {
            f = string.concat(f, " probe cp", _itoa(k), " ", label, " reverted ", _selector(err));
        }
        return f;
    }

    /// @dev The case input with choices after k removed (a fresh copy each call).
    function _prefix(string memory json, uint8 k) internal pure returns (PaidRaceEngine.CoreInput memory input) {
        input = _input(json);
        for (uint256 j = k; j < 3; ++j) {
            delete input.choices[j];
        }
    }

    // ------------------------------------------------------------ divergence

    function _firstDivergence(string memory json, PaidRaceEngine.CoreInput memory input, uint8 stopAt)
        internal
        view
        returns (string memory)
    {
        (PaidRaceEngine.Result memory r,) = this.runCore(input, _opts(stopAt, true));
        if (!vm.keyExistsJson(json, ".expected.events")) {
            return string.concat("no event list in vector; solidity logged ", _itoa(r.eventCount));
        }
        uint256 expectedCount = vm.parseJsonUint(json, ".expected.eventCount");
        uint256 n = expectedCount < r.eventCount ? expectedCount : r.eventCount;
        for (uint256 j; j < n; ++j) {
            (uint256 meta, int256 arg) = _expectedEvent(json, j);
            if (meta != r.eventMeta[j] || arg != r.eventArgs[j]) {
                return string.concat(
                    "first divergence at event ",
                    _itoa(j),
                    ": expected ",
                    _event(meta, arg),
                    " got ",
                    _event(r.eventMeta[j], r.eventArgs[j])
                );
            }
        }
        return string.concat(
            "events agree for ", _itoa(n), " entries; expected ", _itoa(expectedCount), " got ", _itoa(r.eventCount)
        );
    }

    // ------------------------------------------------------------ derivation

    function _isDerived(string memory name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        return b.length > 8 && b[0] == "d" && b[7] == "-";
    }

    function _derivedIndex(string memory name) internal pure returns (uint256 index) {
        bytes memory b = bytes(name);
        for (uint256 i = 8; i < b.length; ++i) {
            index = index * 10 + uint8(b[i]) - 48;
        }
    }

    function _requireDerivation(
        string memory name,
        PaidRaceEngine.CoreInput memory core,
        IPaidRaceSolver.RaceInput memory input
    ) internal pure {
        PaidProfiles.Profile[5] memory profiles = PaidProfiles.derive(
            input.seed, input.openAnchor, input.stakeTier, input.playerHorseId
        );
        uint8[14] memory deck = PaidDeck.derive(input.seed, input.openAnchor);
        for (uint256 h; h < 5; ++h) {
            require(
                keccak256(abi.encode(profiles[h])) == keccak256(abi.encode(core.profiles[h])),
                string.concat(name, ": derived profile")
            );
            if (h == input.playerHorseId) continue;
            require(
                keccak256(abi.encode(PaidCpuDeck.derive(input.seed, input.openAnchor, uint8(h))))
                    == keccak256(abi.encode(core.cpuDecks[h])),
                string.concat(name, ": derived cpu deck")
            );
        }
        require(keccak256(abi.encode(deck)) == keccak256(abi.encode(core.playerDeck)), string.concat(name, ": deck"));
    }

    /// @dev solve() gas beyond the engine on the first derived full race: derivation, ABI coding and the call.
    function _solveOverhead(string[] memory cases) internal returns (uint256) {
        LegacyCoreSolverProbe solver = new LegacyCoreSolverProbe();
        for (uint256 i; i < cases.length; ++i) {
            string memory name = vm.parseJsonString(cases[i], ".name");
            if (!_isDerived(name)) continue;
            PaidRaceEngine.CoreInput memory core = _input(cases[i]);
            IPaidRaceSolver.RaceInput memory raceInput = _derivedRaceInput(core, _derivedIndex(name));
            uint256 before = gasleft();
            solver.solve(raceInput);
            uint256 solveGas = before - gasleft();
            (, uint256 coreGas) = this.runCore(core, _opts(0, false));
            return solveGas > coreGas ? solveGas - coreGas : 0;
        }
        revert("no derived case");
    }

    // ------------------------------------------------------------ helpers
}
