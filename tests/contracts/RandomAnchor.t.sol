// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RandomAnchor} from "../../contracts/libraries/RandomAnchor.sol";
import {Eip2935, PonyVm} from "./PonyGameBase.sol";

contract AnchorHarness {
    mapping(uint256 => bytes32) public anchors;

    function seal(uint256 sourceBlock) external {
        anchors[sourceBlock] = RandomAnchor.read(sourceBlock);
    }

    function tryRead(uint256 sourceBlock) external view returns (bool ok, bytes32 hash) {
        return RandomAnchor.tryRead(sourceBlock);
    }

    function isLost(uint256 sourceBlock) external view returns (bool) {
        return RandomAnchor.isLost(sourceBlock);
    }
}

contract RandomAnchorTest {
    PonyVm constant vm = PonyVm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    bytes32 constant KNOWN_HASH = keccak256("canonical block");
    bytes32 constant HISTORY_HASH = keccak256("history block");
    AnchorHarness harness;

    function setUp() public {
        harness = new AnchorHarness();
        vm.roll(20_000);
    }

    function _installHistory() internal {
        vm.etch(Eip2935.HISTORY, Eip2935.RUNTIME);
    }

    function _history(bytes memory data) internal view returns (bool ok, bytes memory out) {
        (ok, out) = Eip2935.HISTORY.staticcall(data);
    }

    // ------------------------------------------------------------ BLOCKHASH window

    function testSameBlockCannotBeSealed() public {
        (bool ok,) = address(harness).call(abi.encodeCall(AnchorHarness.seal, (vm.getBlockNumber())));
        require(!ok, "same block hash accepted");
    }

    function testNextBlockHashCanBeSealedAndRetained() public {
        uint256 source = vm.getBlockNumber();
        vm.roll(source + 1);
        vm.setBlockhash(source, KNOWN_HASH);
        harness.seal(source);
        require(harness.anchors(source) == KNOWN_HASH, "wrong sealed hash");
        vm.roll(source + 300);
        require(harness.anchors(source) == KNOWN_HASH, "sealed hash expired");
    }

    function testDirectWindowEndsAfter256BlocksWithoutHistory() public {
        uint256 source = vm.getBlockNumber();
        vm.roll(source + 256);
        vm.setBlockhash(source, KNOWN_HASH);
        harness.seal(source);
        require(harness.anchors(source) == KNOWN_HASH, "256-block edge rejected");
        vm.roll(source + 257);
        (bool ok,) = address(harness).call(abi.encodeCall(AnchorHarness.seal, (source)));
        require(!ok, "expired block hash accepted without a history contract");
        require(harness.isLost(source), "no history contract: lost after 256 blocks");
    }

    // ------------------------------------------------------------ EIP-2935 bytecode

    /// @dev Pins the getter/setter semantics of the deployed runtime code the library relies on.
    function testHistoryBytecodeSemantics() public {
        _installHistory();
        uint256 number = vm.getBlockNumber();
        vm.store(Eip2935.HISTORY, Eip2935.slot(number - 1), KNOWN_HASH);
        vm.store(Eip2935.HISTORY, Eip2935.slot(number - 8191), HISTORY_HASH);

        (bool ok, bytes memory out) = _history(abi.encode(number - 1));
        require(ok && out.length == 32 && abi.decode(out, (bytes32)) == KNOWN_HASH, "parent hash");
        (ok, out) = _history(abi.encode(number - 8191));
        require(ok && abi.decode(out, (bytes32)) == HISTORY_HASH, "8191-block edge");
        (ok,) = _history(abi.encode(number - 8192));
        require(!ok, "8192 blocks back must revert");
        (ok,) = _history(abi.encode(number));
        require(!ok, "current block must revert");
        (ok,) = _history(abi.encode(number + 1));
        require(!ok, "future block must revert");
        (ok,) = _history(abi.encodePacked(uint248(number - 1)));
        require(!ok, "31-byte input must revert");
        (ok,) = _history(abi.encodePacked(number - 1, uint8(0)));
        require(!ok, "33-byte input must revert");
        (ok, out) = _history(abi.encode(number - 2));
        require(ok && abi.decode(out, (bytes32)) == bytes32(0), "unwritten slot reads zero");

        // Setter: only the system address, storing the parent hash at (number - 1) % 8191.
        bytes32 parent = keccak256("parent");
        vm.prank(Eip2935.SYSTEM);
        (ok,) = Eip2935.HISTORY.call(abi.encode(parent));
        require(ok && vm.load(Eip2935.HISTORY, Eip2935.slot(number - 1)) == parent, "system setter");
        (ok,) = Eip2935.HISTORY.call(abi.encode(bytes32(uint256(number - 1))));
        require(ok, "non-system caller is a getter");
        require(vm.load(Eip2935.HISTORY, Eip2935.slot(number - 1)) == parent, "non-system caller wrote");
    }

    // ------------------------------------------------------------ library over the history window

    function testReadUsesHistoryFrom257To8191Blocks() public {
        _installHistory();
        uint256 source = vm.getBlockNumber();
        vm.setBlockhash(source, KNOWN_HASH);
        vm.store(Eip2935.HISTORY, Eip2935.slot(source), HISTORY_HASH);
        vm.roll(source + 1);
        require(_read(source) == KNOWN_HASH, "direct window must use BLOCKHASH");
        vm.roll(source + 257);
        require(_read(source) == HISTORY_HASH, "257 blocks via history");
        vm.roll(source + 300);
        require(_read(source) == HISTORY_HASH, "300 blocks via history");
        vm.roll(source + 8191);
        require(_read(source) == HISTORY_HASH, "8191 blocks via history");
        require(!harness.isLost(source), "readable anchor reported lost");
        vm.roll(source + 8192);
        (bool ok, bytes32 hash) = harness.tryRead(source);
        require(!ok && hash == bytes32(0), "8192 blocks must be unavailable");
        require(harness.isLost(source), "expired anchor not lost");
        vm.roll(source + 9000);
        (bool stored,) = address(harness).call(abi.encodeCall(AnchorHarness.seal, (source)));
        require(!stored && harness.isLost(source), "9000 blocks must be unavailable");
    }

    function testZeroHistoryEntryIsRejectedAndLost() public {
        _installHistory();
        uint256 source = vm.getBlockNumber();
        vm.roll(source + 300);
        (bool ok, bytes32 hash) = harness.tryRead(source);
        require(!ok && hash == bytes32(0), "zero hash accepted");
        (bool stored,) = address(harness).call(abi.encodeCall(AnchorHarness.seal, (source)));
        require(!stored, "zero hash sealed");
        require(harness.isLost(source), "a never-recorded block cannot become readable");
    }

    function testPendingBlocksAreNeverLost() public {
        _installHistory();
        uint256 number = vm.getBlockNumber();
        (bool ok,) = harness.tryRead(number);
        require(!ok, "current block readable");
        require(!harness.isLost(number) && !harness.isLost(number + 5), "pending block reported lost");
    }

    function _read(uint256 source) internal returns (bytes32) {
        harness.seal(source);
        return harness.anchors(source);
    }
}
