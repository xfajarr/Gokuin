// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The only shape Chainlink CRE's Forwarder ever calls. There is no CRE
///         capability that invokes an arbitrary typed function on a consumer, so
///         anything receiving a Confidential Workflow's output must present this.
/// @dev Confirmed against docs.chain.link/cre/guides/workflow/using-evm-client/
///      onchain-write/building-consumer-contracts.
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
