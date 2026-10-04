// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";
import {PaidRaceVectorBase} from "./PaidRaceVectorBase.sol";

/// @dev Shared field-by-field comparisons for legacy and roster-aware parity vectors.
abstract contract PaidRaceVectorAssertions is PaidRaceVectorBase {
    /// @notice Worst legal solve. Alchemy caps a sponsored user operation at 27M total gas and adds about 11%, so
    /// the settlement's solve must stay at or below 23.5M. This is an infrastructure budget, not a measurement:
    /// the measured worst cases (`gas <case>` and `worst roster solve gas` in -vv output) sit far below it and
    /// only decide whether the budget is still achievable, never what it is.
    uint256 internal constant SOLVE_GAS_CAP = 23_500_000;

    function _compareRace(string memory name, string memory json, PaidRaceEngine.Result memory r)
        internal
        pure
        returns (string memory f)
    {
        f = _cmpArray(f, "finishTime", vm.parseJsonUintArray(json, ".expected.finishTime"), _u32(r.finishTime));
        f = _cmpArray(f, "finishWall", vm.parseJsonUintArray(json, ".expected.finishWall"), _u32(r.finishWall));
        f = _cmpArray(f, "rawOrder", vm.parseJsonUintArray(json, ".expected.rawOrder"), _u8x5(r.rawOrder));
        f = _cmpArray(
            f, "settlementOrder", vm.parseJsonUintArray(json, ".expected.settlementOrder"), _u8x5(r.settlementOrder)
        );
        f = _cmp(f, "rawRank", vm.parseJsonUint(json, ".expected.rawRank"), r.rawRank);
        f = _cmp(f, "settlementRank", vm.parseJsonUint(json, ".expected.settlementRank"), r.settlementRank);
        f = _cmp(f, "versionAnswer", vm.parseJsonBool(json, ".expected.versionAnswer") ? 1 : 0, r.versionAnswer ? 1 : 0);
        f = _cmpArray(
            f,
            "acquiredByCheckpoint",
            vm.parseJsonUintArray(json, ".expected.acquiredByCheckpoint"),
            _u8x3(r.acquiredByCheckpoint)
        );
        f = _cmpArray(f, "acquired", vm.parseJsonUintArray(json, ".expected.acquired"), _acquired(r));
        f = _cmp(f, "eventCount", vm.parseJsonUint(json, ".expected.eventCount"), r.eventCount);
        f = _cmp(f, "stepCount", vm.parseJsonUint(json, ".expected.stepCount"), r.stepCount);
        f = _cmp(f, "digest", uint256(vm.parseJsonBytes32(json, ".expected.digest")), uint256(r.digest));
        f = _cmp(f, "status", 0, r.status);
        for (uint256 k; k < 3; ++k) {
            f = _compareRecord(f, json, k, r.checkpoints[k]);
        }
        if (bytes(f).length != 0) f = string.concat(name, ":", f);
    }

    function _compareRecord(string memory f, string memory json, uint256 k, PaidRaceEngine.Record memory rec)
        internal
        pure
        returns (string memory)
    {
        string memory p = _key(".expected.checkpoints", k, "");
        string memory tag = string.concat("cp", _itoa(k + 1), ".");
        f = _cmp(
            f,
            string.concat(tag, "reached"),
            vm.parseJsonBool(json, string.concat(p, ".reached")) ? 1 : 0,
            rec.reached ? 1 : 0
        );
        f = _cmpStr(f, string.concat(tag, "mode"), _optString(json, string.concat(p, ".mode")), _modeName(rec.mode));
        f = _cmp(f, string.concat(tag, "openTau"), vm.parseJsonUint(json, string.concat(p, ".openTau")), rec.openTau);
        f = _cmp(f, string.concat(tag, "openWall"), vm.parseJsonUint(json, string.concat(p, ".openWall")), rec.openWall);
        f = _cmp(f, string.concat(tag, "openSec"), vm.parseJsonUint(json, string.concat(p, ".openSec")), rec.openSec);
        f = _cmp(
            f,
            string.concat(tag, "deadlineSec"),
            vm.parseJsonUint(json, string.concat(p, ".deadlineSec")),
            rec.deadlineSec
        );
        f = _cmp(
            f, string.concat(tag, "closeWall"), vm.parseJsonUint(json, string.concat(p, ".closeWall")), rec.closeWall
        );
        f = _cmp(f, string.concat(tag, "closeTau"), vm.parseJsonUint(json, string.concat(p, ".closeTau")), rec.closeTau);
        f = _cmpStr(
            f,
            string.concat(tag, "reason"),
            vm.parseJsonString(json, string.concat(p, ".reason")),
            _reasonName(rec.reason)
        );
        f = _cmp(f, string.concat(tag, "cardId"), vm.parseJsonUint(json, string.concat(p, ".cardId")), rec.cardId);
        f = _cmp(
            f,
            string.concat(tag, "invalidReason"),
            vm.parseJsonUint(json, string.concat(p, ".invalidReason")),
            rec.invalidReason
        );
        f = _cmpArray(
            f,
            string.concat(tag, "candidates"),
            vm.parseJsonUintArray(json, string.concat(p, ".candidates")),
            _candidates(rec.candidateCount, rec.candidates)
        );
        return f;
    }

    function _comparePanel(string memory name, string memory json, PaidRaceEngine.Result memory r)
        internal
        pure
        returns (string memory f)
    {
        f = _cmpStr(f, "status", vm.parseJsonString(json, ".expected.status"), _statusName(r.status));
        bool expectPanel = vm.keyExistsJson(json, ".expected.panel.checkpoint");
        f = _cmp(f, "hasPanel", expectPanel ? 1 : 0, r.hasPanel ? 1 : 0);
        if (expectPanel && r.hasPanel) {
            PaidRaceEngine.PanelView memory p = r.panel;
            f = _cmp(f, "panel.checkpoint", vm.parseJsonUint(json, ".expected.panel.checkpoint"), p.checkpoint);
            f = _cmpStr(f, "panel.mode", vm.parseJsonString(json, ".expected.panel.mode"), _modeName(p.mode));
            f = _cmp(f, "panel.openTau", vm.parseJsonUint(json, ".expected.panel.openTau"), p.openTau);
            f = _cmp(f, "panel.openWall", vm.parseJsonUint(json, ".expected.panel.openWall"), p.openWall);
            f = _cmp(f, "panel.openSec", vm.parseJsonUint(json, ".expected.panel.openSec"), p.openSec);
            f = _cmp(f, "panel.deadlineSec", vm.parseJsonUint(json, ".expected.panel.deadlineSec"), p.deadlineSec);
            f = _cmp(f, "draw.cursor", vm.parseJsonUint(json, ".expected.panel.drawState.cursor"), p.draw.cursor);
            f = _cmp(
                f, "draw.tailCursor", vm.parseJsonUint(json, ".expected.panel.drawState.tailCursor"), p.draw.tailCursor
            );
            f = _cmp(
                f,
                "draw.refreshCredits",
                vm.parseJsonUint(json, ".expected.panel.drawState.refreshCredits"),
                p.draw.refreshCredits
            );
            f = _cmp(
                f,
                "draw.automatic",
                vm.parseJsonBool(json, ".expected.panel.drawState.automatic") ? 1 : 0,
                p.draw.automatic ? 1 : 0
            );
            f = _cmp(
                f,
                "draw.forfeited",
                vm.parseJsonBool(json, ".expected.panel.drawState.forfeited") ? 1 : 0,
                p.draw.forfeited ? 1 : 0
            );
            f = _cmpArray(
                f,
                "panel.candidates",
                vm.parseJsonUintArray(json, ".expected.panel.candidates"),
                _candidates(p.candidateCount, p.candidates)
            );
        }
        f = _cmp(f, "eventCount", vm.parseJsonUint(json, ".expected.eventCount"), r.eventCount);
        f = _cmp(f, "digest", uint256(vm.parseJsonBytes32(json, ".expected.digest")), uint256(r.digest));
        if (bytes(f).length != 0) f = string.concat(name, ":", f);
    }

    /// @notice RaceResult of the deployed solver against the vector (the IPaidRaceSolver fields).
    function _compareRaceResult(string memory name, string memory json, IPaidRaceSolver.RaceResult memory r)
        internal
        pure
        returns (string memory f)
    {
        f = _cmpArray(f, "finishTime", vm.parseJsonUintArray(json, ".expected.finishTime"), _u32(r.finishTime));
        f = _cmpArray(f, "finishWall", vm.parseJsonUintArray(json, ".expected.finishWall"), _u32(r.finishWall));
        f = _cmpArray(f, "rawOrder", vm.parseJsonUintArray(json, ".expected.rawOrder"), _u8x5(r.rawOrder));
        f = _cmpArray(
            f, "settlementOrder", vm.parseJsonUintArray(json, ".expected.settlementOrder"), _u8x5(r.settlementOrder)
        );
        f = _cmp(f, "rawRank", vm.parseJsonUint(json, ".expected.rawRank"), r.playerRawRank);
        f = _cmp(f, "settlementRank", vm.parseJsonUint(json, ".expected.settlementRank"), r.playerSettlementRank);
        f = _cmpArray(f, "acquired", vm.parseJsonUintArray(json, ".expected.acquiredByCheckpoint"), _u8x3(r.acquired));
        f = _cmp(f, "eventCount", vm.parseJsonUint(json, ".expected.eventCount"), r.eventCount);
        f = _cmp(f, "digest", uint256(vm.parseJsonBytes32(json, ".expected.digest")), uint256(r.digest));
        uint8 player = uint8(vm.parseJsonUint(json, ".input.playerHorseId"));
        f = _cmp(f, "settlementOrder[rank-1] == player", player, r.settlementOrder[r.playerSettlementRank - 1]);
        if (bytes(f).length != 0) f = string.concat(name, ":", f);
    }

    // ------------------------------------------------------------ stored-choice judgement

    /// @notice stopAtPanel cases: a forfeit stored at the panel's opening second takes effect in a manual panel and is
    /// ignored (CHOICE_INVALID AUTO/CUT, no revert) in an auto or cut one; the same forfeit one second early is EARLY.

    function _expectedEvent(string memory json, uint256 j) internal pure returns (uint256 meta, int256 arg) {
        string memory p = _key(".expected.events", j, "");
        meta = vm.parseJsonUint(json, string.concat(p, ".code"))
            | (vm.parseJsonUint(json, string.concat(p, ".tau")) << 8)
            | (vm.parseJsonUint(json, string.concat(p, ".horse")) << 40);
        arg = vm.parseJsonInt(json, string.concat(p, ".arg"));
    }

    function _event(uint256 meta, int256 arg) internal pure returns (string memory) {
        return string.concat(
            "(code ",
            _itoa(meta & 0xff),
            ", tau ",
            _itoa((meta >> 8) & 0xffffffff),
            ", horse ",
            _itoa(meta >> 40),
            ", arg ",
            vm.toString(arg),
            ")"
        );
    }

    function _cmp(string memory f, string memory what, uint256 expected, uint256 actual)
        internal
        pure
        returns (string memory)
    {
        if (expected == actual) return f;
        return string.concat(f, " ", what, " expected ", vm.toString(expected), " got ", vm.toString(actual));
    }

    function _cmpStr(string memory f, string memory what, string memory expected, string memory actual)
        internal
        pure
        returns (string memory)
    {
        if (_eq(expected, actual)) return f;
        return string.concat(f, " ", what, " expected '", expected, "' got '", actual, "'");
    }

    function _cmpArray(string memory f, string memory what, uint256[] memory expected, uint256[] memory actual)
        internal
        pure
        returns (string memory)
    {
        if (keccak256(abi.encode(expected)) == keccak256(abi.encode(actual))) return f;
        return string.concat(f, " ", what, " expected ", _join(expected), " got ", _join(actual));
    }

    function _join(uint256[] memory values) internal pure returns (string memory out) {
        out = "[";
        for (uint256 i; i < values.length; ++i) {
            out = string.concat(out, i == 0 ? "" : ",", _itoa(values[i]));
        }
        out = string.concat(out, "]");
    }

    /// @dev A JSON null (record mode of an unopened checkpoint) reads back as "null".
    function _optString(string memory json, string memory key) internal pure returns (string memory s) {
        s = vm.parseJsonString(json, key);
        if (_eq(s, "null")) s = "";
    }

    function _selector(bytes memory err) internal pure returns (string memory) {
        if (err.length < 4) return "(no data)";
        return vm.toString(bytes32(bytes4(err)));
    }

    function _u32(uint32[5] memory a) internal pure returns (uint256[] memory out) {
        out = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            out[i] = a[i];
        }
    }

    function _u8x5(uint8[5] memory a) internal pure returns (uint256[] memory out) {
        out = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            out[i] = a[i];
        }
    }

    function _u8x3(uint8[3] memory a) internal pure returns (uint256[] memory out) {
        out = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            out[i] = a[i];
        }
    }

    function _candidates(uint256 count, uint8[3] memory values) internal pure returns (uint256[] memory out) {
        out = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            out[i] = values[i];
        }
    }

    function _acquired(PaidRaceEngine.Result memory r) internal pure returns (uint256[] memory out) {
        uint256 n;
        for (uint256 k; k < 3; ++k) {
            if (r.acquiredByCheckpoint[k] != 0) ++n;
        }
        out = new uint256[](n);
        n = 0;
        for (uint256 k; k < 3; ++k) {
            if (r.acquiredByCheckpoint[k] != 0) out[n++] = r.acquiredByCheckpoint[k];
        }
    }
}
