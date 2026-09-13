// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";

interface IENSOwner {
    function owner(bytes32 node) external view returns (address);
}

/// @notice Registers the three routes as ENSv2 subnames. Separate from `Deploy`
///         because it depends on something no contract can do for itself: the
///         parent name must exist and `RouteRegistry` must own it.
///
///         Folding this into the deploy meant one revert here rolled back four
///         contract deployments — which is exactly what happened the first time.
///
/// Required env vars:
///   ROUTE_REGISTRY_ADDRESS  from the deploy output.
///   ENS_REGISTRY            same registry the deploy used.
///
/// Optional:
///   PARENT_NODE             namehash of the parent (default: namehash("gokuin.eth")).
///
/// Prerequisite, and the script checks it before spending gas:
///   You own the parent name on Sepolia, and have transferred that node to
///   RouteRegistry:
///     cast send $ENS_REGISTRY "setOwner(bytes32,address)" $PARENT_NODE $ROUTE_REGISTRY_ADDRESS
contract RegisterRoutes is Script {
    /// @dev Index is the on-chain routeId. Must match
    ///      `packages/core/src/types.ts::ROUTE_IDS` and never be reordered.
    string[3] internal ROUTE_LABELS = ["public-mempool", "flashbots-protect", "mev-blocker"];

    function run() external {
        RouteRegistry registry = RouteRegistry(vm.envAddress("ROUTE_REGISTRY_ADDRESS"));
        address ensRegistry = vm.envAddress("ENS_REGISTRY");
        bytes32 parentNode = vm.envOr("PARENT_NODE", registry.parentNode());

        address parentOwner = IENSOwner(ensRegistry).owner(parentNode);
        if (parentOwner != address(registry)) {
            console.log("Parent node is owned by", parentOwner);
            console.log("It must be owned by RouteRegistry at", address(registry));
            console.log("Run:");
            console.log("  cast send <ENS_REGISTRY> 'setOwner(bytes32,address)' <PARENT_NODE> <ROUTE_REGISTRY>");
            revert("parent node not owned by RouteRegistry");
        }

        vm.startBroadcast();
        for (uint32 i = 0; i < ROUTE_LABELS.length; i++) {
            bytes32 node = registry.registerRoute(i, ROUTE_LABELS[i]);
            console.log("Registered route", ROUTE_LABELS[i]);
            console.logBytes32(node);
        }
        vm.stopBroadcast();
    }
}
