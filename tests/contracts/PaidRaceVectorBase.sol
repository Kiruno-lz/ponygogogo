// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PaidProfiles} from "../../contracts/libraries/PaidProfiles.sol";
import {PaidRaceEngine} from "../../contracts/libraries/PaidRaceEngine.sol";

/// @dev Cheatcodes for reading tests/vectors/paid-race-v4.json (the repo has no forge-std).
interface VectorVm {
    function readFile(string calldata path) external view returns (string memory);
    function split(string calldata input, string calldata delimiter) external pure returns (string[] memory);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function parseJsonInt(string calldata json, string calldata key) external pure returns (int256);
    function parseJsonUintArray(string calldata json, string calldata key) external pure returns (uint256[] memory);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseJsonBytes32(string calldata json, string calldata key) external pure returns (bytes32);
    function parseJsonBool(string calldata json, string calldata key) external pure returns (bool);
    function keyExistsJson(string calldata json, string calldata key) external pure returns (bool);
    function toString(uint256 value) external pure returns (string memory);
    function toString(int256 value) external pure returns (string memory);
    function toString(bytes32 value) external pure returns (string memory);
}

/// @notice Reads the cross-language vectors. The generator (scripts/gen-paid-vectors.ts render()) writes one case per
/// line after a meta line and a `"cases":[` line, so each case is parsed on its own small JSON string instead of
/// re-parsing the whole 800 KB file for every field.
abstract contract PaidRaceVectorBase {
    VectorVm internal constant vm = VectorVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    string internal constant VECTOR_FILE = "tests/vectors/paid-race-v4.json";
    uint256 internal constant FIRST_CASE_LINE = 2;

    /// @dev Case JSON strings in file order.
    function _cases() internal view returns (string[] memory cases) {
        string memory file = vm.readFile(VECTOR_FILE);
        uint256 count = vm.parseJsonUint(file, ".meta.count");
        string[] memory lines = vm.split(file, "\n");
        require(lines.length >= FIRST_CASE_LINE + count, "vector file shape");
        require(_eq(lines[1], "\"cases\":["), "vector file: cases line");
        cases = new string[](count);
        for (uint256 i; i < count; ++i) {
            bytes memory line = bytes(lines[FIRST_CASE_LINE + i]);
            if (line[line.length - 1] == ",") {
                assembly ("memory-safe") {
                    mstore(line, sub(mload(line), 1))
                }
            }
            cases[i] = string(line);
        }
    }

    function _key(string memory prefix, uint256 index, string memory suffix) internal pure returns (string memory) {
        return string.concat(prefix, "[", _itoa(index), "]", suffix);
    }

    function _itoa(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        bytes memory out = new bytes(78);
        uint256 n;
        while (value != 0) {
            out[n++] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        bytes memory rev = new bytes(n);
        for (uint256 i; i < n; ++i) {
            rev[i] = out[n - 1 - i];
        }
        return string(rev);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @notice decodeInput: the explicit core input of one case.
    function _input(string memory json) internal pure returns (PaidRaceEngine.CoreInput memory input) {
        for (uint256 h; h < 5; ++h) {
            string memory p = _key(".input.profiles", h, "");
            input.profiles[h] = PaidProfiles.Profile(
                uint32(vm.parseJsonUint(json, string.concat(p, ".base"))),
                uint32(vm.parseJsonUint(json, string.concat(p, ".acceleration"))),
                uint32(vm.parseJsonUint(json, string.concat(p, ".cap")))
            );
            uint256[] memory cpu = vm.parseJsonUintArray(json, _key(".input.cpuDecks", h, ""));
            require(cpu.length == 3, "cpu deck length");
            for (uint256 i; i < 3; ++i) {
                input.cpuDecks[h][i] = uint8(cpu[i]);
            }
        }
        input.playerHorseId = uint8(vm.parseJsonUint(json, ".input.playerHorseId"));
        uint256[] memory deck = vm.parseJsonUintArray(json, ".input.playerDeck");
        require(deck.length == 14, "player deck length");
        for (uint256 i; i < 14; ++i) {
            input.playerDeck[i] = uint8(deck[i]);
        }
        input.seed = vm.parseJsonBytes32(json, ".input.seed");
        input.openAnchor = vm.parseJsonBytes32(json, ".input.openAnchor");
        for (uint256 k; k < 3; ++k) {
            string memory c = _key(".input.choices", k, "");
            if (!vm.keyExistsJson(json, string.concat(c, ".txSec"))) continue;
            uint256[] memory slots = vm.parseJsonUintArray(json, string.concat(c, ".refreshSlots"));
            uint8[] memory refresh = new uint8[](slots.length);
            for (uint256 i; i < slots.length; ++i) {
                refresh[i] = uint8(slots[i]);
            }
            input.choices[k] = IPaidRaceSolver.ChoiceInput(
                true,
                uint32(vm.parseJsonUint(json, string.concat(c, ".txSec"))),
                uint8(vm.parseJsonUint(json, string.concat(c, ".cardId"))),
                refresh,
                vm.parseJsonBytes32(json, string.concat(c, ".anchor"))
            );
        }
    }

    /// @notice The RaceInput a derived-<i> case came from (gen-paid-vectors.ts: tier i % 4 + 1, horse i % 5).
    function _derivedRaceInput(PaidRaceEngine.CoreInput memory core, uint256 index)
        internal
        pure
        returns (IPaidRaceSolver.RaceInput memory input)
    {
        input.seed = core.seed;
        input.openAnchor = core.openAnchor;
        input.stakeTier = uint8(index % 4 + 1);
        input.playerHorseId = core.playerHorseId;
        input.choices = core.choices;
    }

    function _modeName(uint256 mode) internal pure returns (string memory) {
        if (mode == PaidRaceEngine.MODE_MANUAL) return "manual";
        if (mode == PaidRaceEngine.MODE_AUTO) return "auto";
        if (mode == PaidRaceEngine.MODE_CUT) return "cut";
        return "";
    }

    function _reasonName(uint256 reason) internal pure returns (string memory) {
        if (reason == PaidRaceEngine.REASON_OPEN) return "open";
        if (reason == PaidRaceEngine.REASON_PICKED) return "picked";
        if (reason == PaidRaceEngine.REASON_FORFEIT_TX) return "forfeit-tx";
        if (reason == PaidRaceEngine.REASON_TIMEOUT) return "timeout";
        if (reason == PaidRaceEngine.REASON_AUTO) return "auto";
        if (reason == PaidRaceEngine.REASON_CUT) return "cut";
        if (reason == PaidRaceEngine.REASON_FINISHED) return "finished";
        return "not-reached";
    }

    function _statusName(uint256 status) internal pure returns (string memory) {
        if (status == PaidRaceEngine.STATUS_PANEL) return "panel";
        if (status == PaidRaceEngine.STATUS_WALL) return "wall";
        return "complete";
    }
}
