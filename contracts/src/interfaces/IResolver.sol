// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IResolver
/// @notice Minimal text-record resolver interface, shaped like ENS's standard
///         `ITextResolver` (EIP-634).
/// @dev ASSUMPTION: same caveat as `INameRegistry` — ENSv2 beta's exact resolver
///      interface on Sepolia was not confirmed, so this codes against the long-stable
///      EIP-634 text-record shape that every ENS resolver (v1 or v2) is expected to
///      keep for compatibility with existing tooling (e.g. `ethers`/`viem` `getText`).
interface IResolver {
    /// @notice Read the text record stored under `key` for `node`.
    function text(bytes32 node, string calldata key) external view returns (string memory);
}
