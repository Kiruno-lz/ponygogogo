// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "../../contracts/PaidCardRules.sol";

contract PaidCardRulesTest {
    function testGeneratedCardRulesAndMasks() public pure {
        require(PaidCardRules.RARE_MASK == 0x12973e && PaidCardRules.CPU_MASK == 0x3fae3, "eligibility masks");
        require(
            PaidCardRules.TABLE_HASH == 0x30dea918dfc50683a877ad59c4381a0ef3812ec44456f44a92a6960aaa9b4450, "table hash"
        );
        require(
            PaidCardRules.RULESET_HASH == 0xeb03664a530fd6d5251118e5074b9bd2fa6c5cce60385d94779199160f45edd6,
            "ruleset hash"
        );
        PaidCardRules.Rule memory gravity = PaidCardRules.get(10);
        require(gravity.effect == 10 && gravity.rare && gravity.cpu, "gravity identity");
        require(gravity.durationMs == 10_000 && gravity.slot == 0, "gravity equipment");
        require(gravity.radiusMicro == 8_000_000_000 && gravity.strengthBps == 3_000, "gravity field");
        require(gravity.overlapBps == 3_000, "browser overlap branch");
        PaidCardRules.Rule memory wheel = PaidCardRules.get(11);
        require(wheel.periodMs == 7_000 && wheel.count == 4 && wheel.fixedSpeed == 10, "wheel schedule");
        PaidCardRules.Rule memory placeholder = PaidCardRules.get(26);
        require(placeholder.effect == 0 && !placeholder.rare && !placeholder.cpu, "placeholder");
    }

    /// @dev The packed get() decodes to exactly the TS table (the generator hashes the same ABI encoding with viem).
    function testPackedTableDecodesToTheTsTable() public pure {
        PaidCardRules.Rule[] memory rules = new PaidCardRules.Rule[](26);
        for (uint8 id = 1; id <= 26; ++id) {
            rules[id - 1] = PaidCardRules.get(id);
            require(rules[id - 1].id == id, "card id");
        }
        require(keccak256(abi.encode(rules)) == PaidCardRules.ENCODED_RULES_HASH, "decoded table differs from TS");
    }

    function testUnknownCardReverts() public {
        (bool ok0, bytes memory r0) = address(this).call(abi.encodeCall(this.ruleOf, (0)));
        (bool ok27, bytes memory r27) = address(this).call(abi.encodeCall(this.ruleOf, (27)));
        require(!ok0 && !ok27, "unknown card accepted");
        require(
            bytes4(r0) == PaidCardRules.InvalidCard.selector && bytes4(r27) == PaidCardRules.InvalidCard.selector,
            "error"
        );
    }

    function ruleOf(uint8 id) external pure returns (PaidCardRules.Rule memory) {
        return PaidCardRules.get(id);
    }
}
