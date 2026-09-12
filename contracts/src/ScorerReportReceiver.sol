// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IReceiver} from "./interfaces/IReceiver.sol";
import {Scorer} from "./Scorer.sol";

/// @title ScorerReportReceiver
/// @notice Bridges Chainlink CRE's Forwarder to `Scorer.submitScore`.
///
/// @dev Why this exists at all: the Forwarder only ever calls
///      `onReport(bytes,bytes)`, while `Scorer.submitScore` takes eight typed
///      arguments. Without an adapter the Confidential Workflow computes a score
///      it can never write, and the whole confidential-scoring path is decorative.
///
///      Deployment wires `Scorer.creForwarder` to THIS contract's address, not to
///      Chainlink's raw Forwarder. The single-authorized-writer property that
///      `RouteRegistry` enforces is unchanged: this contract becomes that one
///      writer, and it in turn accepts calls from exactly one address.
///
///      Two hops, two checks, no widening:
///        CRE Forwarder --onReport--> ScorerReportReceiver --submitScore--> Scorer
///                                                          --setScore--> RouteRegistry
contract ScorerReportReceiver is IReceiver {
    /// @notice Chainlink's CRE Forwarder. Immutable — a rotatable relay address
    ///         would be a second authorized writer wearing a disguise.
    address public immutable forwarder;

    /// @notice The Scorer this adapter is permitted to drive.
    Scorer public immutable scorer;

    event ReportForwarded(uint32 indexed routeId, uint16 composite, uint16 lastCycle);

    error NotForwarder(address caller);
    error MalformedReport();

    constructor(address forwarder_, Scorer scorer_) {
        if (forwarder_ == address(0) || address(scorer_) == address(0)) revert MalformedReport();
        forwarder = forwarder_;
        scorer = scorer_;
    }

    /// @inheritdoc IReceiver
    /// @dev `metadata` is CRE's workflow provenance envelope. It is intentionally
    ///      unused: authorisation here is by caller, not by anything the report
    ///      claims about itself. A report that could authorise itself would let
    ///      anyone who can reach this contract write scores.
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);

        (
            uint32 routeId,
            uint16 leakBps,
            uint16 sandwichBps,
            uint16 medianDelay,
            uint16 composite,
            uint32 probes,
            uint16 lastCycle,
            string memory evidenceURI
        ) = abi.decode(report, (uint32, uint16, uint16, uint16, uint16, uint32, uint16, string));

        scorer.submitScore(routeId, leakBps, sandwichBps, medianDelay, composite, probes, lastCycle, evidenceURI);

        emit ReportForwarded(routeId, composite, lastCycle);
    }

    /// @inheritdoc IReceiver
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == 0x01ffc9a7; // ERC-165
    }
}
