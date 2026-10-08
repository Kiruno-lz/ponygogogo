// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "../../contracts/libraries/PaidCardRules.sol";

contract PaidCardRulesTest {
    function testGeneratedCardRulesAndMasks() public pure {
        require(PaidCardRules.RARE_MASK == 0x9610120356 && PaidCardRules.CPU_MASK == 0xbfefe3fae3, "eligibility masks");
        require(
            PaidCardRules.TABLE_HASH == 0xf4d427d2de6ef0c94cfcbf2ff3b9c8550335035ece2c643b122fb37c6bd06f28, "table hash"
        );
        require(
            PaidCardRules.RULESET_HASH == 0xeeaa0e4ce206bb23c12366e9b37be8950e8e2af3de6d7f5d69bdabc99cef716a,
            "ruleset hash"
        );
        PaidCardRules.Rule memory gravity = PaidCardRules.get(10);
        require(gravity.effect == 10 && gravity.rare && gravity.cpu, "gravity identity");
        require(gravity.durationMs == 20_000 && gravity.slot == 0, "gravity equipment");
        require(gravity.radiusMicro == 8_000_000_000 && gravity.strengthBps == 3_000, "gravity field");
        require(gravity.overlapBps == 3_000, "browser overlap branch");
        PaidCardRules.Rule memory wheel = PaidCardRules.get(11);
        require(wheel.periodMs == 1_000 && wheel.count == 3 && wheel.fixedSpeed == 100, "wheel schedule");
        PaidCardRules.Rule memory rage = PaidCardRules.get(26);
        require(rage.effect == PaidCardRules.EFFECT_RAGE && !rage.rare && rage.cpu, "rage");
    }

    /// @dev The packed get() decodes to exactly the TS table (the generator hashes the same ABI encoding with viem).
    function testPackedTableDecodesToTheTsTable() public pure {
        PaidCardRules.Rule[] memory rules = new PaidCardRules.Rule[](40);
        for (uint8 id = 1; id <= 40; ++id) {
            rules[id - 1] = PaidCardRules.get(id);
            require(rules[id - 1].id == id, "card id");
        }
        require(keccak256(abi.encode(rules)) == PaidCardRules.ENCODED_RULES_HASH, "decoded table differs from TS");
    }

    function testUnknownCardReverts() public {
        (bool ok0, bytes memory r0) = address(this).call(abi.encodeCall(this.ruleOf, (0)));
        (bool ok41, bytes memory r41) = address(this).call(abi.encodeCall(this.ruleOf, (41)));
        require(!ok0 && !ok41, "unknown card accepted");
        require(
            bytes4(r0) == PaidCardRules.InvalidCard.selector && bytes4(r41) == PaidCardRules.InvalidCard.selector,
            "error"
        );
    }

    function testMainFunctionUsesTheSpareRgbByteWithoutChangingCoatColors() public pure {
        require(PaidCardRules.mainFunction(7) == PaidCardRules.MAIN_EQUIPMENT, "rocket classification");
        require(PaidCardRules.mainFunction(13) == PaidCardRules.MAIN_INTERFERENCE, "steal classification");
        require(PaidCardRules.mainFunction(29) == PaidCardRules.MAIN_APPEARANCE, "coat gate classification");
        require(PaidCardRules.get(19).coatRgb == 0xf4c542, "yellow changed by metadata");
        require(PaidCardRules.get(20).coatRgb == 0x63b34a, "green changed by metadata");
    }

    function ruleOf(uint8 id) external pure returns (PaidCardRules.Rule memory) {
        return PaidCardRules.get(id);
    }
}
