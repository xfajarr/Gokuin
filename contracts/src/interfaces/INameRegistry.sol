// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title INameRegistry
/// @notice Minimal subset of an ENSv2-style name registry needed to create one subname
///         per route under a parent node.
/// @dev ASSUMPTION: at the time this was written, ENSv2's Sepolia beta registry
///      interface was not pinned down publicly in a way we could code against with
///      confidence. This interface intentionally mirrors the shape of the well-known,
///      already-deployed ENS v1 `ENSRegistry.setSubnodeRecord` — the closest stable
///      reference point — so the calling code below is realistic and swappable: if the
///      final ENSv2 beta registry differs, only this file and its call sites in
///      `RouteRegistry` need to change, not the permission logic that matters for the
///      demo (`RouteRegistry.setScore`'s `onlyScorer` gate).
interface INameRegistry {
    /// @notice Create (or take over, if already owned by the caller) a subnode of
    ///         `node` labelled by `labelHash`, set its owner and resolver, and return
    ///         the resulting node hash.
    /// @param node the parent node (e.g. namehash("gokuin.eth")).
    /// @param labelHash keccak256 of the human-readable label (e.g. keccak256("mev-blocker")).
    /// @param owner_ the address to record as owner of the new subnode.
    /// @param resolver_ the resolver address to record for the new subnode.
    /// @param ttl the ENS record TTL; 0 is a conventional "no explicit TTL" default.
    /// @return node_ the namehash of the created subnode.
    function setSubnodeRecord(bytes32 node, bytes32 labelHash, address owner_, address resolver_, uint64 ttl)
        external
        returns (bytes32 node_);

    /// @notice The recorded owner of `node`, per the registry's own bookkeeping.
    function owner(bytes32 node) external view returns (address);
}
