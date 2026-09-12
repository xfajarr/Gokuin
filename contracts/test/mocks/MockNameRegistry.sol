// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INameRegistry} from "../../src/interfaces/INameRegistry.sol";

/// @notice Minimal stand-in for an ENSv2 name registry, used only in tests. Computes
///         subnode hashes the same way ENS namehashing does (`keccak256(parent, label)`)
///         so `RouteRegistry.nodeOf` values are realistic and stable across calls.
contract MockNameRegistry is INameRegistry {
    mapping(bytes32 => address) internal _owner;

    function setSubnodeRecord(
        bytes32 node,
        bytes32 labelHash,
        address owner_,
        address,
        /* resolver_ */
        uint64 /* ttl */
    )
        external
        override
        returns (bytes32 node_)
    {
        node_ = keccak256(abi.encodePacked(node, labelHash));
        _owner[node_] = owner_;
    }

    function owner(bytes32 node) external view override returns (address) {
        return _owner[node];
    }
}
