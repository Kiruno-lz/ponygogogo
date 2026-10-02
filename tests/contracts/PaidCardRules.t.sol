// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PaidCardRules} from "../../contracts/PaidCardRules.sol";

contract PaidCardRulesTest {
    function testGeneratedCardRulesAndMasks() public pure {
        require(PaidCardRules.RARE_MASK == 0xf6e232973e && PaidCardRules.CPU_MASK == 0xbfefe3fae3, "eligibility masks");
        require(
            PaidCardRules.TABLE_HASH == 0xb8351e02bafc73263c6f8c040ab3c53f2dae91e1515e10b0540145d11e07336e, "table hash"
        );
        require(
            PaidCardRules.RULESET_HASH == 0x1f3e8d6c57b309a94e9550a022396329611552c9d1f982cf64d050afa95fe85b,
            "ruleset hash"
        );
        PaidCardRules.Rule memory gravity = PaidCardRules.get(10);
        require(gravity.effect == 10 && gravity.rare && gravity.cpu, "gravity identity");
        require(gravity.durationMs == 10_000 && gravity.slot == 0, "gravity equipment");
        require(gravity.radiusMicro == 8_000_000_000 && gravity.strengthBps == 6_000, "gravity field");
        require(gravity.overlapBps == 6_000, "browser overlap branch");
        PaidCardRules.Rule memory wheel = PaidCardRules.get(11);
        require(wheel.periodMs == 7_000 && wheel.count == 4 && wheel.fixedSpeed == 10, "wheel schedule");
        PaidCardRules.Rule memory placeholder = PaidCardRules.get(26);
        require(placeholder.effect == PaidCardRules.EFFECT_RAGE && placeholder.rare && placeholder.cpu, "rage");
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
        (bool ok27, bytes memory r27) = address(this).call(abi.encodeCall(this.ruleOf, (41)));
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
