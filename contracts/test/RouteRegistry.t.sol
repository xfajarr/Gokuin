// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";
import {MockNameRegistry} from "./mocks/MockNameRegistry.sol";

contract RouteRegistryTest is Test {
    RouteRegistry internal registry;
    MockNameRegistry internal ens;
    address internal scorer = makeAddr("scorer");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant PARENT_NODE = keccak256("gokuin.eth");

    function setUp() public {
        ens = new MockNameRegistry();
        registry = new RouteRegistry(scorer, address(ens), PARENT_NODE);
    }

    // ── test_OnlyScorerWritesENS ────────────────────────────────────────────
    // Asserts: a non-scorer `setScore` call MUST revert. This is the ENS track's
    // proof — enforced by the contract, not promised in a README.
    function test_OnlyScorerWritesENS() public {
        registry.registerRoute(1, "mev-blocker");

        vm.prank(stranger);
        vm.expectRevert(RouteRegistry.NotScorer.selector);
        registry.setScore(1, "gokuin.leakBps", "42");

        // The legitimate scorer, meanwhile, succeeds and the record is actually
        // resolvable — proving this isn't just a revert with no working path behind it.
        vm.prank(scorer);
        registry.setScore(1, "gokuin.leakBps", "42");

        bytes32 node = registry.nodeOf(1);
        assertEq(registry.text(node, "gokuin.leakBps"), "42");
    }

    function test_RegisterRouteIsIdempotentPerRoute() public {
        registry.registerRoute(2, "flashbots-protect");
        vm.expectRevert(RouteRegistry.RouteAlreadyRegistered.selector);
        registry.registerRoute(2, "flashbots-protect-again");
    }

    function test_RegisterRouteRevertsOnEmptyLabel() public {
        vm.expectRevert(RouteRegistry.EmptyLabel.selector);
        registry.registerRoute(3, "");
    }

    function test_SetScoreRevertsForUnknownRoute() public {
        vm.prank(scorer);
        vm.expectRevert(RouteRegistry.RouteUnknown.selector);
        registry.setScore(99, "gokuin.leakBps", "0");
    }

    function test_RegisterRouteRecordsThisContractAsEnsOwner() public {
        bytes32 node = registry.registerRoute(0, "public-mempool");
        // RouteRegistry must be its own resolver/owner so the permission check it
        // enforces (onlyScorer) is the only gate that matters, independent of any
        // external resolver's own ACL.
        assertEq(ens.owner(node), address(registry));
        assertEq(registry.routeOfNode(node), 0);
    }
}
