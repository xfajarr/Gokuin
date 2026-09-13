// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRegistry
/// @notice The real, minimal ENSv2 registry interface. Every ENSv2 name can define its own
///         registry; resolution walks the chain of registries label-by-label, from the root
///         down, calling exactly these two functions at each level
///         (`UniversalResolverV2`'s traversal in `LibRegistry.findResolver`):
///           `exactRegistry.getResolver(label)`: remember it if non-zero.
///           `exactRegistry.getSubregistry(label)`: descend into it for the next label.
///         `getParent` is metadata only (used by `LibRegistry.findCanonicalName` to reconstruct
///         a registry's canonical DNS name) and is not consulted during resolution.
/// @dev Verified against the authoritative source, `ensdomains/contracts-v2`
///      (`contracts/src/registry/interfaces/IRegistry.sol`,
///      https://github.com/ensdomains/contracts-v2/blob/48b3e2d39513b9dd32ef1850877a29009bc807b9/contracts/src/registry/interfaces/IRegistry.sol),
///      commit 48b3e2d, and cross-checked against `LibRegistry.findResolver` in the same repo
///      (`contracts/src/universalResolver/libraries/LibRegistry.sol`). This file omits
///      `IRegistryEvents` (the real `IRegistry` also inherits that) because `RouteRegistry`
///      does not implement the ERC1155/`PermissionedRegistry` surface those events describe
///      (`LabelRegistered`, `TokenRegenerated`, etc.): see `RouteRegistry`'s own doc comment
///      for why that is a deliberate, documented scope choice and not a guess.
interface IRegistry {
    /// @notice Fetches the registry for a label.
    /// @param label The label to resolve.
    /// @return The address of the registry for this label, or `address(0)` if none exists.
    function getSubregistry(string calldata label) external view returns (IRegistry);

    /// @notice Fetches the resolver responsible for the specified label.
    /// @param label The label to fetch a resolver for.
    /// @return resolver The address of a resolver responsible for this label, or `address(0)` if none exists.
    function getResolver(string calldata label) external view returns (address resolver);

    /// @notice Get canonical "location" of this registry.
    /// @return parent The canonical parent of this registry.
    /// @return label The canonical subdomain of this registry.
    function getParent() external view returns (IRegistry parent, string memory label);
}
