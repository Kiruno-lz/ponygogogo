// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {PonyGameBase, VmLog} from "./PonyGameBase.sol";
import {IPaidRaceSolver} from "../../contracts/interfaces/IPaidRaceSolver.sol";
import {PonyGame} from "../../contracts/PonyGame.sol";

contract PonyGameRosterTest is PonyGameBase {
    function testConstructorAnnouncesItsPersistentRewardLedger() public {
        vm.recordLogs();
        PonyGame indexedGame = new PonyGame(address(this), solver, rewards);
        VmLog[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(indexedGame) && logs[i].topics[0] == keccak256("RewardsBound(address)")) {
                require(address(uint160(uint256(logs[i].topics[1]))) == address(rewards), "wrong reward ledger");
                return;
            }
        }
        revert("indexer cannot discover reward ledger");
    }

    /// @dev Under `vm.prank` the raw call's value is debited from ALICE, like a real transaction.
    function _openRoster(uint8 playerSlot, uint8[5] memory roster) private returns (bool ok, bytes memory data) {
        vm.prank(ALICE);
        return address(game).call{value: TIER1}(
            abi.encodeWithSignature("openSession(uint8,uint256,uint8[5])", playerSlot, TIER1, roster)
        );
    }

    function testEntryStoresEnabledRosterWithoutRequiringOwnership() public {
        uint8[5] memory roster = [uint8(5), 7, 8, 6, 0];
        require(rewards.ownedMask(ALICE) == 0, "fixture already owns ponies");
        vm.recordLogs();
        (bool ok, bytes memory data) = _openRoster(2, roster);
        require(ok, "required roster entry unavailable");
        bytes32 id = abi.decode(data, (bytes32));
        _mine(1, 1);
        IPaidRaceSolver.RaceInput memory input = game.raceInput(id);
        require(keccak256(abi.encode(input.roster)) == keccak256(abi.encode(roster)), "lost roster");
        require(input.playerHorseId == 2, "slot changed identity");
        VmLog[] memory logs = vm.getRecordedLogs();
        bool opened;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(game)
                    && logs[i].topics[0]
                        == keccak256(
                            "SessionOpened(bytes32,address,uint8,uint256,bytes32,uint64,uint64,bytes32,uint8[5])"
                        )
            ) {
                (,,,,,, uint8[5] memory eventRoster) =
                    abi.decode(logs[i].data, (uint8, uint256, bytes32, uint64, uint64, bytes32, uint8[5]));
                require(keccak256(abi.encode(eventRoster)) == keccak256(abi.encode(roster)), "event roster");
                opened = true;
            }
        }
        require(opened, "no roster in opening event");
    }

    /// @notice ABI parity with the TS caller (`src/chain/paidCalls.ts`): both entry points take
    /// `(uint8,uint256,uint8[5])` and `SessionOpened` carries nine fields — two indexed plus seven in the data,
    /// `roster` last. A silent reordering or a dropped field would change the selector or the topic.
    function testRosterEntryAbiMatchesTheTsEncoding() public {
        require(
            PonyGame.openSession.selector == bytes4(keccak256("openSession(uint8,uint256,uint8[5])")),
            "openSession selector drifted from (uint8,uint256,uint8[5])"
        );
        require(
            PonyGame.openAgentSession.selector == bytes4(keccak256("openAgentSession(uint8,uint256,uint8[5])")),
            "openAgentSession selector drifted from (uint8,uint256,uint8[5])"
        );
        uint8[5] memory roster = [uint8(4), 0, 8, 2, 6];
        vm.recordLogs();
        (bool ok, bytes memory data) = _openRoster(1, roster);
        require(ok, "roster entry unavailable");
        bytes32 sessionId = abi.decode(data, (bytes32));
        VmLog[] memory logs = vm.getRecordedLogs();
        bool opened;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(game)) continue;
            if (
                logs[i].topics[0]
                    != keccak256("SessionOpened(bytes32,address,uint8,uint256,bytes32,uint64,uint64,bytes32,uint8[5])")
            ) continue;
            require(logs[i].topics.length == 3, "SessionOpened must index exactly sessionId and player");
            require(logs[i].topics[1] == sessionId, "indexed sessionId");
            require(address(uint160(uint256(logs[i].topics[2]))) == ALICE, "indexed player");
            // Seven non-indexed fields, decoded positionally: a reordering fails here, not just on the topic.
            // 6 words for the scalars plus 5 inline words for `uint8[5]`.
            require(logs[i].data.length == 11 * 32, "SessionOpened data must hold 7 fields (roster inline)");
            (
                uint8 horseId,
                uint256 stake,
                bytes32 seed,
                uint64 openedAt,
                uint64 openedBlock,
                bytes32 ruleset,
                uint8[5] memory eventRoster
            ) = abi.decode(logs[i].data, (uint8, uint256, bytes32, uint64, uint64, bytes32, uint8[5]));
            PonyGame.SessionView memory s = game.getSession(sessionId);
            require(horseId == 1 && stake == TIER1, "horseId/stake");
            require(seed == s.seed && ruleset == RULESET, "seed/rulesetHash");
            require(openedAt == uint64(vm.getBlockTimestamp()) && openedBlock == uint64(vm.getBlockNumber()), "open");
            require(keccak256(abi.encode(eventRoster)) == keccak256(abi.encode(roster)), "event roster");
            opened = true;
        }
        require(opened, "no SessionOpened with the nine-field shape");
    }

    function testInvalidRosterAndSlotNeverLockStakeOrIncrementNonce() public {
        uint8[5][3] memory invalid = [[uint8(0), 1, 2, 3, 3], [uint8(0), 1, 2, 3, 9], [uint8(0), 1, 2, 3, 255]];
        uint256 before = ALICE.balance;
        uint256 vaultBefore = address(vault).balance;
        for (uint256 i; i < invalid.length; ++i) {
            (bool ok, bytes memory data) = _openRoster(0, invalid[i]);
            require(!ok && bytes4(data) == PonyGame.InvalidEntry.selector, "invalid roster accepted");
        }
        (bool slotOk, bytes memory slotData) = _openRoster(5, [uint8(0), 1, 2, 3, 4]);
        require(!slotOk && bytes4(slotData) == PonyGame.InvalidEntry.selector, "slot out of range accepted");
        require(ALICE.balance == before, "rejected entry took the stake");
        require(
            address(vault).balance == vaultBefore && game.nonces(ALICE) == 0, "invalid entry mutated funds or nonce"
        );
    }
}
