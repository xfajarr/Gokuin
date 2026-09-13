// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";
import {Scorer} from "../src/Scorer.sol";

contract ScorerTest is Test {
    RouteRegistry internal registry;
    Scorer internal scorer;
    address internal creForwarder = makeAddr("creForwarder");
    address internal stranger = makeAddr("stranger");
    address internal ethRegistry = makeAddr("ethRegistry");
    bytes32 internal constant PARENT_NODE = keccak256("gokuin.eth");

    function setUp() public {
        // `RouteRegistry.scorer` must be the `Scorer` contract's own address; compute
        // it ahead of deployment since both constructors reference each other.
        address predictedScorer = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new RouteRegistry(predictedScorer, ethRegistry, PARENT_NODE, "gokuin");
        scorer = new Scorer(creForwarder, registry);
        assertEq(address(scorer), predictedScorer, "scorer address prediction must hold");

        registry.registerRoute(2, "mev-blocker");
    }

    // Asserts: only `creForwarder` may call `submitScore`; any other sender reverts
    // `NotCRE`, mirroring the same "enforced, not promised" property as `RouteRegistry`.
    function test_OnlyCREWritesScores() public {
        vm.prank(stranger);
        vm.expectRevert(Scorer.NotCRE.selector);
        scorer.submitScore(2, 12, 34, 5, 99, 7, 3, "ipfs://evidence");
    }

    // Asserts: a legitimate CRE submission emits `Scored` with the full tuple and lands
    // ALL SIX `gokuin.*` text keys in `RouteRegistry` — not just the four the previous,
    // narrower signature had data for. `probes` and `lastCycle` are now first-class
    // parameters instead of an unwritten gap.
    function test_SubmitScoreWritesAllSixKeys() public {
        vm.expectEmit(true, false, false, true, address(scorer));
        emit Scorer.Scored(2, 12, 34, 5, 99);

        vm.prank(creForwarder);
        scorer.submitScore(2, 12, 34, 5, 99, 7, 3, "ipfs://evidence");

        bytes32 node = registry.nodeOf(2);
        assertEq(registry.text(node, "gokuin.leakBps"), "12");
        assertEq(registry.text(node, "gokuin.sandwichBps"), "34");
        assertEq(registry.text(node, "gokuin.medianDelay"), "5");
        assertEq(registry.text(node, "gokuin.probes"), "7");
        assertEq(registry.text(node, "gokuin.lastCycle"), "3");
        assertEq(registry.text(node, "gokuin.evidenceURI"), "ipfs://evidence");
    }

    // Asserts the property the ENS demo moment actually rests on: exactly one address
    // — `registry.scorer()`, i.e. this `Scorer` contract — can ever write a score text
    // record. Fuzzed over arbitrary callers (excluding the real scorer) so this isn't
    // just "the one stranger we happened to try" but "no address other than the one
    // authorised writer", which is the claim made on camera.
    function testFuzz_ExactlyOneAuthorizedWriterToRegistry(address caller) public {
        vm.assume(caller != address(scorer));
        vm.prank(caller);
        vm.expectRevert(RouteRegistry.NotScorer.selector);
        registry.setScore(2, "gokuin.leakBps", "1");

        // And the one address that is authorised — the Scorer contract itself, called
        // the only legitimate way (via submitScore, gated onlyCRE) — does succeed.
        assertEq(registry.scorer(), address(scorer));
        vm.prank(creForwarder);
        scorer.submitScore(2, 1, 1, 1, 1, 1, 1, "ipfs://evidence");
    }
}
