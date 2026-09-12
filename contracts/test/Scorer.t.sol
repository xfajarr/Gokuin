// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";
import {Scorer} from "../src/Scorer.sol";
import {MockNameRegistry} from "./mocks/MockNameRegistry.sol";

contract ScorerTest is Test {
    RouteRegistry internal registry;
    Scorer internal scorer;
    MockNameRegistry internal ens;
    address internal creForwarder = makeAddr("creForwarder");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant PARENT_NODE = keccak256("gokuin.eth");

    function setUp() public {
        ens = new MockNameRegistry();
        // `RouteRegistry.scorer` must be the `Scorer` contract's own address; compute
        // it ahead of deployment since both constructors reference each other.
        address predictedScorer = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new RouteRegistry(predictedScorer, address(ens), PARENT_NODE);
        scorer = new Scorer(creForwarder, registry);
        assertEq(address(scorer), predictedScorer, "scorer address prediction must hold");

        registry.registerRoute(2, "mev-blocker");
    }

    // Asserts: only `creForwarder` may call `submitScore`; any other sender reverts
    // `NotCRE`, mirroring the same "enforced, not promised" property as `RouteRegistry`.
    function test_OnlyCREWritesScores() public {
        vm.prank(stranger);
        vm.expectRevert(Scorer.NotCRE.selector);
        scorer.submitScore(2, 12, 34, 5, 99, "ipfs://evidence");
    }

    // Asserts: a legitimate CRE submission both emits `Scored` with the full tuple and
    // actually lands the four PRD text keys it has data for in `RouteRegistry`.
    function test_SubmitScoreWritesThroughToRegistry() public {
        vm.expectEmit(true, false, false, true, address(scorer));
        emit Scorer.Scored(2, 12, 34, 5, 99);

        vm.prank(creForwarder);
        scorer.submitScore(2, 12, 34, 5, 99, "ipfs://evidence");

        bytes32 node = registry.nodeOf(2);
        assertEq(registry.text(node, "gokuin.leakBps"), "12");
        assertEq(registry.text(node, "gokuin.sandwichBps"), "34");
        assertEq(registry.text(node, "gokuin.medianDelay"), "5");
        assertEq(registry.text(node, "gokuin.evidenceURI"), "ipfs://evidence");
    }
}
