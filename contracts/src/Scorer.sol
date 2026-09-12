// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RouteRegistry} from "./RouteRegistry.sol";

/// @title Scorer
/// @notice Receives the weighted score from the CRE Confidential Workflow and forwards
///         it into `RouteRegistry` as ENS text records.
/// @dev Weights never appear on-chain — only their output does. `creForwarder` is the
///      only address permitted to call `submitScore`; in the deployed system that is
///      the Chainlink CRE forwarder that relays the Confidential Workflow's output.
///
///      The PRD's `submitScore` signature carries `leakBps`, `sandwichBps`,
///      `medianDelay`, `composite` and `evidenceURI`, but `RouteRegistry`'s documented
///      key set also includes `gokuin.probes` and `gokuin.lastCycle`. Those two are not
///      populated here because this function is never handed a probe count or a cycle
///      id to write — that data lives in `ProbeLedger`, not in the CRE workflow's
///      output. Writing them is left to whatever admin/cycle-summary path ends up
///      composing them (out of scope for this contract); `composite` itself is not one
///      of `RouteRegistry`'s six text keys either, so it is only ever emitted in
///      `Scored`, never written as a text record.
contract Scorer {
    /// @notice The only address permitted to call `submitScore`.
    address public immutable creForwarder;

    /// @notice The registry this scorer writes through.
    RouteRegistry public immutable registry;

    event Scored(uint32 indexed routeId, uint16 leakBps, uint16 sandwichBps, uint16 medianDelay, uint16 composite);

    error NotCRE();

    modifier onlyCRE() {
        if (msg.sender != creForwarder) revert NotCRE();
        _;
    }

    /// @param creForwarder_ the CRE forwarder address permitted to submit scores.
    /// @param registry_ the `RouteRegistry` this scorer is authorised to write into —
    ///        that registry must have been deployed with this contract's address (or
    ///        the address this contract will be deployed to) as its `scorer`.
    constructor(address creForwarder_, RouteRegistry registry_) {
        creForwarder = creForwarder_;
        registry = registry_;
    }

    /// @notice Submit one route's freshly computed score. Writes through to
    ///         `RouteRegistry.setScore` for each metric that has a corresponding text
    ///         key, and emits `Scored` with the full tuple including `composite`.
    /// @param routeId the route being scored.
    /// @param leakBps leak rate in basis points.
    /// @param sandwichBps sandwich rate in basis points.
    /// @param medianDelay median inclusion delay, in blocks.
    /// @param composite the weighted composite score; emitted only, not a text record.
    /// @param evidenceURI a pointer to the evidence backing this score (e.g. a subgraph
    ///        query URL or an IPFS URI over the contributing rows).
    function submitScore(
        uint32 routeId,
        uint16 leakBps,
        uint16 sandwichBps,
        uint16 medianDelay,
        uint16 composite,
        string calldata evidenceURI
    ) external onlyCRE {
        registry.setScore(routeId, "gokuin.leakBps", _toString(leakBps));
        registry.setScore(routeId, "gokuin.sandwichBps", _toString(sandwichBps));
        registry.setScore(routeId, "gokuin.medianDelay", _toString(medianDelay));
        registry.setScore(routeId, "gokuin.evidenceURI", evidenceURI);

        emit Scored(routeId, leakBps, sandwichBps, medianDelay, composite);
    }

    /// @dev Minimal decimal-string conversion for `uint16` metric values, avoiding an
    ///      external string-utils dependency for a four-digit-max number.
    function _toString(uint16 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 v = value;
        uint256 digits;
        uint256 temp = v;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (v != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(buffer);
    }
}
