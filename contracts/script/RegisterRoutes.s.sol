// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";

/// @dev Minimal read-only view of ENSv2's real `IRegistry.getSubregistry(string)`
///      (`ensdomains/contracts-v2`, `contracts/src/registry/interfaces/IRegistry.sol`). The ABI
///      encoding of an `IRegistry`-typed return value is identical to `address`, so this
///      single-function interface is enough for the prerequisite check below without pulling in
///      the whole contracts-v2 package.
interface IRegistryView {
    function getSubregistry(string calldata label) external view returns (address);
}

/// @notice Registers the three routes as ENSv2 subnames of RouteRegistry's own namespace.
///         Separate from `Deploy` because it depends on something no contract can do for
///         itself: `gokuin.eth`'s ENSv2 subregistry must already point at `RouteRegistry` —
///         only the name's owner (or an address it granted `ROLE_SET_SUBREGISTRY`) can set
///         that, via `ETHRegistry.setSubregistry`.
///
///         Folding this into the deploy meant one revert here rolled back four
///         contract deployments — which is exactly what happened the first time.
///
/// Required env vars:
///   ROUTE_REGISTRY_ADDRESS  from the deploy output.
///
/// Prerequisite, and the script checks it before spending gas: `RouteRegistry` must be
/// registered as `gokuin.eth`'s ENSv2 subregistry. `RouteRegistry` itself already stores the
/// real `ETHRegistry` address and the parent label it was deployed with
/// (`registry.ethRegistry()`, `registry.parentLabel()`), so this script reads those instead of
/// requiring separate, potentially-mismatched env vars.
contract RegisterRoutes is Script {
    /// @dev Index is the on-chain routeId. Must match
    ///      `packages/core/src/types.ts::ROUTE_IDS` and never be reordered.
    string[3] internal ROUTE_LABELS = ["public-mempool", "flashbots-protect", "mev-blocker"];

    function run() external {
        RouteRegistry registry = RouteRegistry(vm.envAddress("ROUTE_REGISTRY_ADDRESS"));
        address ethRegistry = registry.ethRegistry();
        string memory parentLabel = registry.parentLabel();

        address currentSubregistry = IRegistryView(ethRegistry).getSubregistry(parentLabel);
        if (currentSubregistry != address(registry)) {
            bytes32 labelHash = keccak256(bytes(parentLabel));
            console.log("gokuin.eth's ENSv2 subregistry is currently", currentSubregistry);
            console.log("It must be RouteRegistry, at", address(registry));
            console.log("Run this once, as the owner of gokuin.eth, then re-run this script:");
            console.log("");
            console.log("  cast send", ethRegistry);
            console.log("    \"setSubregistry(uint256,address)\"", vm.toString(uint256(labelHash)), address(registry));
            console.log("    --private-key <owner-of-gokuin.eth> --rpc-url $SEPOLIA_RPC");
            console.log("");
            revert("RouteRegistry is not gokuin.eth's ENSv2 subregistry yet");
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
