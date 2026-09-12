// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ScorerReportReceiver} from "../src/ScorerReportReceiver.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";
import {Scorer} from "../src/Scorer.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";
import {MockNameRegistry} from "./mocks/MockNameRegistry.sol";

/// @notice The adapter widens the path from CRE to RouteRegistry by exactly one
///         hop, and must not widen who may write. These tests pin that.
contract ScorerReportReceiverTest is Test {
    MockNameRegistry ens;
    RouteRegistry registry;
    Scorer scorer;
    ScorerReportReceiver receiver;

    address constant FORWARDER = address(0xF0);
    bytes32 constant PARENT = keccak256("gokuin.eth");

    function setUp() public {
        ens = new MockNameRegistry();
        // Two-phase wiring: the registry's scorer must be the Scorer, and the
        // Scorer's creForwarder must be the adapter — not Chainlink's Forwarder.
        address predictedScorer = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new RouteRegistry(predictedScorer, address(ens), PARENT);
        scorer = new Scorer(address(0xBEEF), registry);
        assertEq(address(scorer), predictedScorer, "scorer address prediction must hold");
        receiver = new ScorerReportReceiver(FORWARDER, scorer);
        registry.registerRoute(1, "flashbots-protect");
    }

    function _report() internal pure returns (bytes memory) {
        return abi.encode(uint32(1), uint16(93), uint16(0), uint16(2), uint16(9687), uint32(431), uint16(7), "ipfs://x");
    }

    function test_OnlyForwarderMayDeliverAReport() public {
        vm.expectRevert(abi.encodeWithSelector(ScorerReportReceiver.NotForwarder.selector, address(this)));
        receiver.onReport("", _report());
    }

    function testFuzz_NoOtherCallerCanDeliver(address caller) public {
        vm.assume(caller != FORWARDER);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(ScorerReportReceiver.NotForwarder.selector, caller));
        receiver.onReport("", _report());
    }

    function test_ForwarderAddressIsImmutable() public view {
        // A rotatable relay would be a second authorized writer in disguise.
        assertEq(receiver.forwarder(), FORWARDER);
        assertEq(address(receiver.scorer()), address(scorer));
    }

    function test_RejectsZeroAddressWiring() public {
        vm.expectRevert(ScorerReportReceiver.MalformedReport.selector);
        new ScorerReportReceiver(address(0), scorer);
        vm.expectRevert(ScorerReportReceiver.MalformedReport.selector);
        new ScorerReportReceiver(FORWARDER, Scorer(address(0)));
    }

    function test_AdvertisesIReceiver() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(0x01ffc9a7));
        assertFalse(receiver.supportsInterface(0xdeadbeef));
    }

    function test_MalformedReportRevertsRatherThanWritingGarbage() public {
        vm.prank(FORWARDER);
        vm.expectRevert();
        receiver.onReport("", hex"1234");
    }
}
