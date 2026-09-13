// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RouteRegistry} from "./RouteRegistry.sol";

/// @title Scorer
/// @notice Receives the weighted score from the CRE Confidential Workflow and forwards
///         it into `RouteRegistry` as ENS text records.
/// @dev Weights never appear on-chain, only their output does. `creForwarder` is the
///      only address permitted to call `submitScore`; in the deployed system that is
///      the Chainlink CRE forwarder that relays the Confidential Workflow's output.
///
///      `submitScore` writes all six of `RouteRegistry`'s documented text keys
///      (`gokuin.leakBps`, `gokuin.sandwichBps`, `gokuin.medianDelay`, `gokuin.probes`,
///      `gokuin.lastCycle`, `gokuin.evidenceURI`). `probes` and `lastCycle` are accepted
///      as explicit parameters rather than looked up: the CRE workflow already derives
///      its score from the rows it read, so it necessarily knows both values, and
///      passing them through here adds no new trust assumption and no second writer.
///      `RouteRegistry.scorer` stays the only address ever authorised to call
///      `setScore`: the entire "only the Scorer can write, enforced by the contract"
///      claim depends on there being exactly one such writer, and that must not be
///      diluted by giving any other contract (e.g. the API) its own path in.
///      `composite` is not one of the six text keys; it is only ever emitted in
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
    /// @param registry_ the `RouteRegistry` this scorer is authorised to write into :
    ///        that registry must have been deployed with this contract's address (or
    ///        the address this contract will be deployed to) as its `scorer`.
    constructor(address creForwarder_, RouteRegistry registry_) {
        creForwarder = creForwarder_;
        registry = registry_;
    }

    /// @notice Submit one route's freshly computed score. Writes through to
    ///         `RouteRegistry.setScore` for all six `gokuin.*` text keys, and emits
    ///         `Scored` with the full tuple including `composite`.
    /// @param routeId the route being scored.
    /// @param leakBps leak rate in basis points.
    /// @param sandwichBps sandwich rate in basis points.
    /// @param medianDelay median inclusion delay, in blocks.
    /// @param composite the weighted composite score; emitted only, not a text record.
    /// @param probes number of probes contributing to this score, the CRE workflow
    ///        counted these rows itself, so this is not a new trust assumption.
    /// @param lastCycle the most recent cycle id folded into this score.
    /// @param evidenceURI a pointer to the evidence backing this score (e.g. a subgraph
    ///        query URL or an IPFS URI over the contributing rows).
    function submitScore(
        uint32 routeId,
        uint16 leakBps,
        uint16 sandwichBps,
        uint16 medianDelay,
        uint16 composite,
        uint32 probes,
        uint16 lastCycle,
        string calldata evidenceURI
    ) external onlyCRE {
        registry.setScore(routeId, "gokuin.leakBps", _toString(leakBps));
        registry.setScore(routeId, "gokuin.sandwichBps", _toString(sandwichBps));
        registry.setScore(routeId, "gokuin.medianDelay", _toString(medianDelay));
        registry.setScore(routeId, "gokuin.probes", _toString(probes));
        registry.setScore(routeId, "gokuin.lastCycle", _toString(lastCycle));
        registry.setScore(routeId, "gokuin.evidenceURI", evidenceURI);

        emit Scored(routeId, leakBps, sandwichBps, medianDelay, composite);
    }

    /// @dev Minimal decimal-string conversion for the metric values above, avoiding an
    ///      external string-utils dependency for numbers that never exceed `uint32`.
    function _toString(uint256 value) internal pure returns (string memory) {
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
