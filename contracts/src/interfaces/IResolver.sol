// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IResolver
/// @notice Minimal text-record resolver interface: ENSIP-5 / EIP-634 `text(node, key)`.
/// @dev CONFIRMED, not assumed: ENSv2's real resolver, `PermissionedResolver`
///      (`ensdomains/contracts-v2`, `contracts/src/resolver/PermissionedResolver.sol`, commit
///      48b3e2d), lists "ENSIP-5 / EIP-634: text(key)" as one of its supported profiles, and its
///      storage (`_records[node][version]`) is still keyed by `bytes32 node`: the standard
///      ENS namehash, exactly as in v1. ENSv2 changes how a *registry* answers "what resolves
///      this label" (see `IRegistry`), but the resolver profile a client calls once it has the
///      resolver address is unchanged for text records.
///      ENSv2's `PermissionedResolver` additionally implements ENSIP-10's
///      `IExtendedResolver.resolve(bytes name, bytes data)` wildcard-resolution entry point, so
///      one resolver contract can answer for names below the exact level it was set on. That is
///      not needed here: `RouteRegistry` sets itself as the resolver only for the exact labels it
///      registers (`registerRoute`), never as a catch-all for anything below them, so a plain,
///      non-wildcard `text(node, key)` is the complete and correct profile, implementing
///      `IExtendedResolver` on top would add surface area with no effect on the one guarantee
///      that matters here (`RouteRegistry.setScore`'s `onlyScorer` gate).
interface IResolver {
    /// @notice Read the text record stored under `key` for `node`.
    function text(bytes32 node, string calldata key) external view returns (string memory);
}
