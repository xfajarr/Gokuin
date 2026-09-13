// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IRegistry} from "../src/interfaces/IRegistry.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";

contract RouteRegistryTest is Test {
    RouteRegistry internal registry;
    address internal scorer = makeAddr("scorer");
    address internal stranger = makeAddr("stranger");
    address internal ethRegistry = makeAddr("ethRegistry");
    bytes32 internal constant PARENT_NODE = keccak256("gokuin.eth");

    function setUp() public {
        registry = new RouteRegistry(scorer, ethRegistry, PARENT_NODE, "gokuin");
    }

    // ── test_OnlyScorerWritesENS ────────────────────────────────────────────
    // Asserts: a non-scorer `setScore` call MUST revert. This is the ENS track's
    // proof, enforced by the contract, not promised in a README.
    function test_OnlyScorerWritesENS() public {
        registry.registerRoute(1, "mev-blocker");

        vm.prank(stranger);
        vm.expectRevert(RouteRegistry.NotScorer.selector);
        registry.setScore(1, "gokuin.leakBps", "42");

        // The legitimate scorer, meanwhile, succeeds and the record is actually
        // resolvable, proving this isn't just a revert with no working path behind it.
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

    // RouteRegistry IS the ENSv2 subregistry: after registration, it must answer the exact two
    // IRegistry calls ENSv2 traversal (`LibRegistry.findResolver`) makes for that label.
    function test_RegisterRouteMakesThisContractTheResolver() public {
        bytes32 node = registry.registerRoute(0, "public-mempool");
        assertEq(registry.getResolver("public-mempool"), address(registry));
        assertEq(address(registry.getSubregistry("public-mempool")), address(0));
        assertEq(registry.routeOfNode(node), 0);
    }

    // An unregistered label must resolve to nothing. RouteRegistry only answers for labels it
    // actually registered, not arbitrary strings.
    function test_GetResolverIsZeroForUnregisteredLabel() public view {
        assertEq(registry.getResolver("not-a-route"), address(0));
    }

    // IRegistry.getParent() is metadata ENSv2 tooling (LibRegistry.findCanonicalName) uses to
    // reconstruct a registry's canonical DNS name, must point back at gokuin.eth's registry.
    function test_GetParentPointsAtEthRegistryAndGokuinLabel() public view {
        (IRegistry parent, string memory label) = registry.getParent();
        assertEq(address(parent), ethRegistry);
        assertEq(label, "gokuin");
    }
}
