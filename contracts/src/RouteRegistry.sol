// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRegistry} from "./interfaces/IRegistry.sol";
import {IResolver} from "./interfaces/IResolver.sol";

/// @title RouteRegistry
/// @notice `RouteRegistry` IS the ENSv2 subregistry for `gokuin.eth`. It owns the
///         `public-mempool` / `flashbots-protect` / `mev-blocker` namespace directly, there is
///         no external "ENS registry" this contract calls into to create those subnames, because
///         in ENSv2's hierarchical model a registry answers for its own labels
///         (`getSubregistry`/`getResolver`), it does not ask another contract to record them.
///
///         This is a deliberate architectural change from a v1-shaped design, driven by the real
///         ENSv2 interface (verified against `ensdomains/contracts-v2`, commit 48b3e2d, see
///         `interfaces/IRegistry.sol` and `interfaces/IResolver.sol` for exact source links):
///           - `gokuin.eth` is already registered on Sepolia in ENSv2's `ETHRegistry`
///             (`0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2`), owned by this project's deployer.
///           - The owner calls `ETHRegistry.setSubregistry(<gokuin labelhash>, RouteRegistry)`
///             **once, out of band** (see `script/RegisterRoutes.s.sol`): this is the one
///             ENSv2 write this contract cannot do for itself, since only the name's owner (or
///             an address it granted `ROLE_SET_SUBREGISTRY`) may call that.
///           - From then on, resolving `mev-blocker.gokuin.eth` walks: root → `ETHRegistry`
///             (`getSubregistry("gokuin")` → `RouteRegistry`) → `RouteRegistry`
///             (`getResolver("mev-blocker")` → `RouteRegistry` itself, since it is also its own
///             resolver, for the same reason the v1-shaped version was: the "only the Scorer may
///             write scores" guarantee then lives in exactly one place (`setScore`'s
///             `onlyScorer` check), not split across a registry ACL and a separate resolver ACL.
///
/// @dev Scope, stated plainly rather than faked: `RouteRegistry` implements the real, minimal
///      `IRegistry` (the interface every ENSv2 resolution client actually calls, confirmed via
///      `LibRegistry.findResolver` in the same repo) and the real EIP-634 `IResolver.text`. It
///      deliberately does NOT implement `PermissionedRegistry`'s ERC1155/`EnhancedAccessControl`
///      surface (transferable ownership, expiry, role delegation, `IRegistryEvents`): routes are
///      three fixed labels created once by trusted deploy tooling, never transferred, never
///      expire, and never sub-delegate roles, so that machinery would add attack surface and
///      reasoning burden with no benefit to the one property this contract exists to prove.
contract RouteRegistry is IRegistry, IResolver {
    /// @notice The only address permitted to write score text records. Immutable.
    address public immutable scorer;

    /// @notice The ENSv2 registry `gokuin.eth` is registered in (e.g. ETHRegistry on Sepolia).
    ///         Stored only for `getParent()` and for `RegisterRoutes`'s prerequisite check :
    ///         this contract never calls it to create subnames (see contract-level doc).
    address public immutable ethRegistry;

    /// @notice The namehash of the parent name (`namehash("gokuin.eth")`), used only to key each
    ///         route's text records (`node = namehash(label.gokuin.eth)`), exactly as an
    ///         ENS-aware client (viem/ethers `getEnsText`) computes `node` off-chain before
    ///         calling `resolver.text(node, key)`. Unrelated to ENSv2 registry traversal, which
    ///         is label-string-based, not node-based (see `IRegistry`).
    bytes32 public immutable parentNode;

    /// @notice The label this registry answers for under its parent (e.g. "gokuin").
    string public parentLabel;

    /// @notice routeId → ENS node. Zero means "not registered".
    mapping(uint32 => bytes32) public nodeOf;

    /// @notice ENS node → routeId, the inverse of `nodeOf`.
    mapping(bytes32 => uint32) public routeOfNode;

    /// @dev keccak256(label) → registered, so `getResolver`/`getSubregistry` can answer ENSv2
    ///      traversal queries by label string, per `IRegistry`.
    mapping(bytes32 => bool) internal _labelRegistered;

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

    /// @param scorer_ the only address ever permitted to call `setScore`: in practice the
    ///        deployed `Scorer` contract's address.
    /// @param ethRegistry_ the ENSv2 registry `gokuin.eth` lives in (metadata only; see above).
    /// @param parentNode_ `namehash("gokuin.eth")`, used to key text records (see above).
    /// @param parentLabel_ the label this registry answers for under `ethRegistry_` (`"gokuin"`).
    constructor(address scorer_, address ethRegistry_, bytes32 parentNode_, string memory parentLabel_) {
        scorer = scorer_;
        ethRegistry = ethRegistry_;
        parentNode = parentNode_;
        parentLabel = parentLabel_;
    }

    /// @notice Register `<label>.gokuin.eth`: this contract becomes both the answer to
    ///         `getResolver(label)` and the sole holder of that label's text records.
    /// @dev Not scorer-gated: registering the label→routeId mapping is a one-time setup step,
    ///      distinct from writing scores, and the PRD does not ask for it to be restricted. It is
    ///      idempotent per `routeId`: a route can only ever be registered once, which prevents a
    ///      later call from re-pointing an existing route's node. No external call is made: in
    ///      ENSv2's hierarchical model, this contract IS the subregistry for these labels once
    ///      the operator points `ETHRegistry` at it (see `script/RegisterRoutes.s.sol`); it does
    ///      not need to ask another contract to record that.
    /// @param routeId the on-chain route id (see `packages/core/src/types.ts::ROUTE_IDS`).
    /// @param label the ENS label, e.g. "mev-blocker".
    /// @return node the namehash of the newly registered subname, used to key its text records.
    function registerRoute(uint32 routeId, string calldata label) external returns (bytes32 node) {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (nodeOf[routeId] != bytes32(0)) revert RouteAlreadyRegistered();

        bytes32 labelHash = keccak256(bytes(label));
        node = keccak256(abi.encodePacked(parentNode, labelHash));

        nodeOf[routeId] = node;
        routeOfNode[node] = routeId;
        _labelRegistered[labelHash] = true;
        emit RouteRegistered(routeId, label, node);
    }

    /// @notice Write a score text record. Reverts for any caller but the Scorer, this
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

    /// @notice ENS text record resolution, standard `IResolver.text`. Read-only, open
    ///         to anyone, exactly as ENS resolution requires.
    function text(bytes32 node, string calldata key) external view override returns (string memory) {
        return _text[node][key];
    }

    /// @inheritdoc IRegistry
    /// @dev Routes are leaf names, none of them has a further subregistry of its own.
    function getSubregistry(string calldata /* label */) external pure override returns (IRegistry) {
        return IRegistry(address(0));
    }

    /// @inheritdoc IRegistry
    /// @dev This contract is the resolver for every label it has registered, and only those.
    function getResolver(string calldata label) external view override returns (address) {
        return _labelRegistered[keccak256(bytes(label))] ? address(this) : address(0);
    }

    /// @inheritdoc IRegistry
    function getParent() external view override returns (IRegistry parent, string memory label) {
        return (IRegistry(ethRegistry), parentLabel);
    }
}
