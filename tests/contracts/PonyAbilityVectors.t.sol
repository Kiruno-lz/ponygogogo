// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidCardRules} from "../../contracts/libraries/PaidCardRules.sol";
import {PaidRaceCold} from "../../contracts/libraries/PaidRaceCold.sol";
import {PonyRules} from "../../contracts/libraries/PonyRules.sol";
import {PaidRaceSolver} from "../../contracts/PaidRaceSolver.sol";
import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidRaceVectorAssertions} from "./PaidRaceVectorAssertions.sol";

contract PonyAbilityVectorsTest is PaidRaceVectorAssertions {
    event log_named_uint(string key, uint256 val);
    event log_named_string(string key, string val);

    string private constant FILE = "tests/vectors/pony-race-v5.json";

    function runVector(string calldata json) external pure returns (PaidRaceEngine.Result memory) {
        return PaidRaceEngine.solve(_input(json), PaidRaceEngine.Options(0, false, 0, true));
    }

    function testRosterVectorHeader() public view {
        string memory file = vm.readFile(FILE);
        require(vm.parseJsonBytes32(file, ".meta.rulesetHash") == PaidCardRules.RULESET_HASH, "v5 ruleset");
        require(vm.parseJsonUint(file, ".meta.count") == 243, "243 directed and derived cases");
    }

    function testPonyVectorsChunk0() public view {
        _chunk(0);
    }

    function testPonyVectorsChunk1() public view {
        _chunk(1);
    }

    function testPonyVectorsChunk2() public view {
        _chunk(2);
    }

    function testPonyVectorsChunk3() public view {
        _chunk(3);
    }

    function testPublicRosterSolverChunk0() public {
        _publicChunk(0);
    }

    function testPublicRosterSolverChunk1() public {
        _publicChunk(1);
    }

    function testPublicRosterSolverChunk2() public {
        _publicChunk(2);
    }

    function _publicChunk(uint256 chunk) private {
        PaidRaceSolver solver = new PaidRaceSolver();
        string[] memory cases = _cases(FILE);
        for (uint256 i = chunk; i < cases.length; i += 3) {
            if (!vm.keyExistsJson(cases[i], ".stakeTier")) continue;
            this.checkPublicVector(solver, cases[i]);
        }
    }

    function checkPublicVector(PaidRaceSolver solver, string calldata json) external view {
        PaidRaceEngine.CoreInput memory core = _input(json);
        IPaidRaceSolver.RaceInput memory input;
        input.seed = core.seed;
        input.openAnchor = core.openAnchor;
        input.playerHorseId = core.playerHorseId;
        input.stakeTier = uint8(vm.parseJsonUint(json, ".stakeTier"));
        input.choices = core.choices;
        input.roster = core.roster;
        string memory failure = _compareRaceResult(vm.parseJsonString(json, ".name"), json, solver.solve(input));
        require(bytes(failure).length == 0, failure);
    }

    /// @notice Settlement gas with the roster path on (plan §4.3 item 2, "复测 gas"), through the deployed Solver
    /// on the 45 derived production cases. Holds the same 23.5M settlement budget the legacy corpus is pinned to
    /// and logs the worst case so the budget stays backed by data.
    function testRosterSolveGasUnderSettlementCap() public {
        PaidRaceSolver solver = new PaidRaceSolver();
        string[] memory cases = _cases(FILE);
        uint256 worstGas;
        string memory worstName;
        uint256 measured;
        for (uint256 i; i < cases.length; ++i) {
            if (!vm.keyExistsJson(cases[i], ".stakeTier")) continue;
            (uint256 used, string memory name) = this.measureVector(solver, cases[i]);
            emit log_named_uint(string.concat("roster solve gas ", name), used);
            if (used > worstGas) {
                worstGas = used;
                worstName = name;
            }
            ++measured;
        }
        require(measured == 45, "45 derived roster cases");
        emit log_named_string("worst roster case", worstName);
        emit log_named_uint("worst roster solve gas", worstGas);
        require(worstGas + 300_000 <= SOLVE_GAS_CAP, "roster solve exceeds the settlement gas budget");
    }

    /// @dev Self-call so each measurement starts from fresh memory, like a settlement transaction.
    function measureVector(PaidRaceSolver solver, string calldata json)
        external
        view
        returns (uint256 used, string memory name)
    {
        PaidRaceEngine.CoreInput memory core = _input(json);
        IPaidRaceSolver.RaceInput memory input;
        input.seed = core.seed;
        input.openAnchor = core.openAnchor;
        input.playerHorseId = core.playerHorseId;
        input.stakeTier = uint8(vm.parseJsonUint(json, ".stakeTier"));
        input.choices = core.choices;
        input.roster = core.roster;
        uint256 before = gasleft();
        solver.solve(input);
        used = before - gasleft();
        name = vm.parseJsonString(json, ".name");
    }

    function testPublicSolverRejectsDuplicateAndUnknownRoles() public {
        PaidRaceSolver solver = new PaidRaceSolver();
        IPaidRaceSolver.RaceInput memory input;
        input.stakeTier = 1;
        input.roster = [uint8(0), 1, 2, 3, 3];
        (bool ok,) = address(solver).staticcall(abi.encodeCall(solver.solve, (input)));
        require(!ok, "duplicate roster accepted");
        input.roster = [uint8(0), 1, 2, 3, 9];
        (ok,) = address(solver).staticcall(abi.encodeCall(solver.solve, (input)));
        require(!ok, "unknown or disabled pony accepted");
    }

    // ------------------------------------------------------- inlined ponyWords / _ponyAcquisition parity (plan §4.3)

    /// @dev External so `_wordsOf` can be probed for reverts; `PaidRaceCold.ponyWords` is `internal`.
    function wordsOf(uint8[5] memory roster) external pure returns (uint256[5] memory) {
        return PaidRaceCold.ponyWords(roster);
    }

    /// @notice The inlined `PaidRaceCold.ponyWords` must be the roster-ordered projection of the TS-pinned
    /// `PonyRules` table (`PonyRules.t.sol` pins `ENCODED_RULES_HASH` against the TS reference), with no
    /// reordering, no masking and no silent acceptance of a duplicate or disabled id.
    function testPonyWordsProjectTheRuleTableInRosterOrder() public view {
        uint8[5][4] memory rosters =
            [[uint8(0), 1, 2, 3, 4], [uint8(8), 7, 6, 5, 4], [uint8(4), 0, 8, 2, 6], [uint8(3), 5, 1, 7, 0]];
        for (uint256 k; k < rosters.length; ++k) {
            uint256[5] memory words = this.wordsOf(rosters[k]);
            for (uint256 h; h < 5; ++h) {
                uint8 id = rosters[k][h];
                require(words[h] == PonyRules.packed(id), "ponyWords slot is not PonyRules.packed(roster[h])");
                PonyRules.Rule memory rule = PonyRules.get(id);
                // The engine reads the ability, the bonus, the equipment factor and the duration straight off the
                // word; pin every field the inlined bit math consumes.
                require(uint8(words[h] >> 144) == rule.id, "word id");
                require(uint8(words[h] >> 136) == 1 && rule.enabled, "word enabled");
                require(uint8(words[h] >> 128) == rule.ability, "word ability");
                require(uint16(words[h] >> 112) == rule.bonusBps, "word bonusBps");
                require(uint32(words[h] >> 80) == rule.durationMs, "word durationMs");
                require(uint16(words[h] >> 64) == rule.equipmentDurationBps, "word equipmentDurationBps");
                require(uint16(words[h] >> 48) == rule.capDelta, "word capDelta");
                require(uint16(words[h] >> 32) == rule.costDeltaBps, "word costDeltaBps");
                require(uint32(words[h]) == rule.staminaMicro, "word staminaMicro");
            }
        }
        (bool ok,) = address(this).staticcall(abi.encodeCall(this.wordsOf, ([uint8(0), 1, 2, 3, 3])));
        require(!ok, "duplicate pony accepted by ponyWords");
        (ok,) = address(this).staticcall(abi.encodeCall(this.wordsOf, ([uint8(0), 1, 2, 3, 9])));
        require(!ok, "unknown pony accepted by ponyWords");
    }

    /// @notice Guards the parity claim itself. The chunk tests only prove the inlined `_ponyAcquisition` matches
    /// the TS reference if the corpus actually fires it, and only cover a pony's passives if that pony appears in
    /// some roster. Fails loudly if a regenerated `pony-race-v5.json` stops exercising a role.
    /// @dev `EV_PONY` is emitted only by the acquisition path, so the expected set is exactly the abilities
    /// `_ponyAcquisition` can grant on (rare specialist, diverse, repeat) or report (forfeit, food) — derived
    /// from the rule table rather than hard-coded, so adding a granting pony fails here until it is covered.
    function testVectorsExerciseEveryPonyAndEveryAcquisition() public view {
        uint256 granting;
        for (uint8 id; id < PonyRules.PONY_COUNT; ++id) {
            uint8 ability = PonyRules.get(id).ability;
            if (
                ability == PonyRules.RARE_SPECIALIST || ability == PonyRules.DIVERSE || ability == PonyRules.REPEAT
                    || ability == PonyRules.FORFEIT || ability == PonyRules.FOOD
            ) granting |= uint256(1) << id;
        }

        uint256 rostered;
        uint256 acquired;
        uint256 total;
        string[] memory cases = _cases(FILE);
        for (uint256 i; i < cases.length; ++i) {
            uint256[] memory ids = vm.parseJsonUintArray(cases[i], ".input.roster");
            for (uint256 h; h < ids.length; ++h) {
                rostered |= uint256(1) << ids[h];
            }
            uint256 count = vm.parseJsonUint(cases[i], ".expected.eventCount");
            for (uint256 j; j < count; ++j) {
                (uint256 meta, int256 arg) = _expectedEvent(cases[i], j);
                if (meta & 0xff != PaidRaceEngine.EV_PONY) continue;
                ++total;
                acquired |= uint256(1) << uint8(uint256(arg) >> 16);
            }
        }
        require(rostered == PonyRules.ENABLED_MASK, "pony-race-v5.json leaves a pony out of every roster");
        require(acquired == granting, "pony-race-v5.json does not fire every granting pony's acquisition");
        require(total >= 243, "too few pony acquisitions to prove _ponyAcquisition parity");
    }

    function _chunk(uint256 chunk) private view {
        string[] memory cases = _cases(FILE);
        for (uint256 i = chunk; i < cases.length; i += 4) {
            string memory json = cases[i];
            string memory name = vm.parseJsonString(json, ".name");
            PaidRaceEngine.Result memory r = this.runVector(json);
            string memory failure = _compareRace(name, json, r);
            require(bytes(failure).length == 0, failure);
            // Compare every event as well as the folded digest, to expose ordering and lifecycle differences.
            for (uint256 j; j < r.eventCount; ++j) {
                (uint256 expectedMeta, int256 expectedArg) = _expectedEvent(json, j);
                require(
                    r.eventMeta[j] == expectedMeta && r.eventArgs[j] == expectedArg,
                    string.concat(
                        name,
                        " event ",
                        _itoa(j),
                        " expected ",
                        _event(expectedMeta, expectedArg),
                        " got ",
                        _event(r.eventMeta[j], r.eventArgs[j])
                    )
                );
            }
        }
    }
}
