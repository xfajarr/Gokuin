// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INameRegistry} from "./interfaces/INameRegistry.sol";
import {IResolver} from "./interfaces/IResolver.sol";

/// @title RouteRegistry
/// @notice One ENSv2 subname per route: `<label>.gokuin.eth`. Score text records are
///         writable ONLY by the Scorer.
/// @dev RouteRegistry is itself the resolver for every subname it creates — when a
///      route is registered, this contract's own address is recorded as both the ENS
///      owner and the resolver of that subnode. That means the "only the Scorer may
///      write scores" guarantee lives in exactly one place (`setScore`'s `onlyScorer`
///      check) instead of depending on a separate resolver contract's own access
///      control, which we do not control and whose ENSv2-beta shape is not yet fixed
///      (see `interfaces/INameRegistry.sol` and `interfaces/IResolver.sol` for the
///      documented assumption). The permission enforcement below is real: any
///      non-Scorer caller of `setScore` reverts, full stop.
contract RouteRegistry is IResolver {
    /// @notice The only address permitted to write score text records. Immutable.
    address public immutable scorer;

    /// @notice The ENSv2 name registry subnames are created against.
    address public immutable ensRegistry;

    /// @notice The parent node subnames are created under (e.g. namehash("gokuin.eth")).
    bytes32 public immutable parentNode;

    /// @notice routeId → ENS node. Zero means "not registered".
    mapping(uint32 => bytes32) public nodeOf;

    /// @notice ENS node → routeId, the inverse of `nodeOf`.
    mapping(bytes32 => uint32) public routeOfNode;

    /// @dev node → key → value. The text records this contract resolves as `IResolver`.
    mapping(bytes32 => mapping(string => string)) internal _text;

    event RouteRegistered(uint32 indexed routeId, string label, bytes32 node);
    event ScoreWritten(uint32 indexed routeId, string key, string value);

    error NotScorer();
    error RouteAlreadyRegistered();
    error RouteUnknown();
    error EmptyLabel();

    modifier onlyScorer() {
        if (msg.sender != scorer) revert NotScorer();
        _;
    }

    /// @param scorer_ the only address ever permitted to call `setScore` — in practice
    ///        the deployed `Scorer` contract's address.
    /// @param ensRegistry_ the ENSv2 name registry to create subnodes against.
    /// @param parentNode_ the parent node all routes are registered under.
    constructor(address scorer_, address ensRegistry_, bytes32 parentNode_) {
        scorer = scorer_;
        ensRegistry = ensRegistry_;
        parentNode = parentNode_;
    }

    /// @notice Create `<label>.gokuin.eth` and point it at this contract as resolver.
    /// @dev Not scorer-gated: registering the label→routeId mapping is a one-time setup
    ///      step, distinct from writing scores, and the PRD does not ask for it to be
    ///      restricted. It is idempotent per `routeId` — a route can only ever be
    ///      registered once, which prevents a later call from re-pointing an existing
    ///      route's node.
    /// @param routeId the on-chain route id (see `packages/core/src/types.ts::ROUTE_IDS`).
    /// @param label the ENS label, e.g. "mev-blocker".
    /// @return node the namehash of the newly created subnode.
    function registerRoute(uint32 routeId, string calldata label) external returns (bytes32 node) {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (nodeOf[routeId] != bytes32(0)) revert RouteAlreadyRegistered();

        bytes32 labelHash = keccak256(bytes(label));
        node = INameRegistry(ensRegistry).setSubnodeRecord(parentNode, labelHash, address(this), address(this), 0);

        nodeOf[routeId] = node;
        routeOfNode[node] = routeId;
        emit RouteRegistered(routeId, label, node);
    }

    /// @notice Write a score text record. Reverts for any caller but the Scorer — this
    ///         is the "only we can write" claim, enforced instead of promised.
    /// @dev Keys written by `Scorer.submitScore`: `gokuin.leakBps`, `gokuin.sandwichBps`,
    ///      `gokuin.medianDelay`, `gokuin.probes`, `gokuin.lastCycle`, `gokuin.evidenceURI`.
    /// @param routeId the route whose record is being updated; must be registered.
    /// @param key the text record key, one of the `gokuin.*` keys above.
    /// @param value the text record value.
    function setScore(uint32 routeId, string calldata key, string calldata value) external onlyScorer {
        bytes32 node = nodeOf[routeId];
        if (node == bytes32(0)) revert RouteUnknown();
        _text[node][key] = value;
        emit ScoreWritten(routeId, key, value);
    }

    /// @notice ENS text record resolution — standard `IResolver.text`. Read-only, open
    ///         to anyone, exactly as ENS resolution requires.
    function text(bytes32 node, string calldata key) external view override returns (string memory) {
        return _text[node][key];
    }
}
