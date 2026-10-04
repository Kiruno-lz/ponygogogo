// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {PonyRules} from "../../contracts/libraries/PonyRules.sol";

contract PonyRulesTest {
    function testPackedRulesMatchCanonicalTsAbiHash() public pure {
        PonyRules.Rule[] memory rules = new PonyRules.Rule[](9);
        for (uint8 id; id < 9; ++id) {
            rules[id] = PonyRules.get(id);
            require(rules[id].id == id && rules[id].enabled, "id/enabled");
        }
        require(keccak256(abi.encode(rules)) == PonyRules.ENCODED_RULES_HASH, "TS/Solidity role data differ");
        require(PonyRules.get(5).capDelta == 100 && PonyRules.get(5).costDeltaBps == 2000, "ox");
        require(PonyRules.get(3).durationMs == 20000 && PonyRules.get(3).bonusBps == 700, "diversity");
        require(PonyRules.get(7).staminaMicro == 50000000, "food");
        require(!PonyRules.enabled(9), "unknown role enabled");
    }
}
