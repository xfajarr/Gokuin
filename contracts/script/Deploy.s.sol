// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ProbeLedger} from "../src/ProbeLedger.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";
import {Scorer} from "../src/Scorer.sol";
import {ScorerReportReceiver} from "../src/ScorerReportReceiver.sol";

/// @notice Deploys `ProbeLedger`, `RouteRegistry` and `Scorer` wired together on
///         Sepolia, then registers the three routes from
///         `packages/core/src/types.ts::ROUTE_IDS` (must stay in that exact order —
///         route ids are positional and never reordered).
///
/// Required env vars:
///   PROBER_ADDRESS      address permitted to write ProbeLedger (the API's hot key).
///   CRE_FORWARDER       Chainlink's own CRE Forwarder on Sepolia. NOTE: this is NOT
///                       what Scorer.creForwarder is set to — see the wiring below.
///   ENS_REGISTRY        the ENSv2 (beta) name registry address on Sepolia.
///   DEPLOYER_PK         private key to broadcast with (or use --private-key / a keystore).
///
/// Optional:
///   PARENT_NODE         namehash of the parent name (default: namehash("gokuin.eth")).
///
/// Usage:
///   bun run deploy:sepolia          (loads the repo-root .env, then runs forge)
///
/// Wiring, in one place because getting it backwards fails silently:
///   Chainlink Forwarder -> ScorerReportReceiver -> Scorer -> RouteRegistry
///   Scorer.creForwarder is the ADAPTER, not Chainlink's Forwarder. The Forwarder
///   only ever calls onReport(bytes,bytes); Scorer takes eight typed arguments.
///   Point Scorer at the raw Forwarder and every confidential score is rejected.
contract Deploy is Script {
    /// @dev Must match `packages/core/src/types.ts::ROUTE_IDS` exactly — index is the
    ///      on-chain routeId, and the order must never change once routes are live.
    string[3] internal ROUTE_LABELS = ["public-mempool", "flashbots-protect", "mev-blocker"];

    struct Deployed {
        ProbeLedger ledger;
        RouteRegistry registry;
        Scorer scorer;
        ScorerReportReceiver adapter;
    }

    function run() external returns (Deployed memory) {
        vm.startBroadcast();
        // Under `forge script --broadcast` the deployments are attributed to the
        // broadcaster, so its nonce is the one the CREATE addresses derive from.
        Deployed memory d = deploy(msg.sender);
        vm.stopBroadcast();
        return d;
    }

    /// @param deployer The account whose nonce the CREATE addresses derive from.
    ///        Passed explicitly rather than assumed: `msg.sender` is the broadcaster
    ///        under `forge script`, but the script contract itself when `run()` is
    ///        called directly from a test. Guessing wrong makes both `require`s below
    ///        fire, which is how this was caught.
    function deploy(address deployer) public returns (Deployed memory) {
        address prober = vm.envAddress("PROBER_ADDRESS");
        address creForwarder = vm.envAddress("CRE_FORWARDER");
        address ensRegistry = vm.envAddress("ENS_REGISTRY");
        bytes32 parentNode = vm.envOr("PARENT_NODE", _namehash("gokuin.eth"));

        ProbeLedger ledger = new ProbeLedger(prober);
        console.log("ProbeLedger deployed at", address(ledger));

        // RouteRegistry's immutable `scorer` must equal the Scorer contract's address,
        // but Scorer's constructor needs a deployed RouteRegistry to point at. Deploy
        // RouteRegistry first against the deterministically-predicted address Scorer
        // will occupy at the very next nonce from this same deployer.
        address predictedScorer = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        RouteRegistry registry = new RouteRegistry(predictedScorer, ensRegistry, parentNode);
        console.log("RouteRegistry deployed at", address(registry));

        // Scorer's only permitted caller is the adapter, which does not exist yet —
        // predict it one nonce further on, the same trick used for Scorer itself.
        address predictedAdapter = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        Scorer scorer = new Scorer(predictedAdapter, registry);
        console.log("Scorer deployed at", address(scorer));
        require(address(scorer) == predictedScorer, "scorer address prediction drifted");

        ScorerReportReceiver adapter = new ScorerReportReceiver(creForwarder, scorer);
        console.log("ScorerReportReceiver deployed at", address(adapter));
        require(address(adapter) == predictedAdapter, "adapter address prediction drifted");
        require(scorer.creForwarder() == address(adapter), "Scorer must point at the adapter");

        console.log("");
        console.log("Routes are NOT registered yet. RouteRegistry cannot create subnames");
        console.log("until it owns the parent node. Next:");
        console.log("  1. register gokuin.eth on Sepolia");
        console.log("  2. cast send <ENS_REGISTRY> 'setOwner(bytes32,address)' <PARENT_NODE> <RouteRegistry>");
        console.log("  3. bun run register:routes");
        console.log("");

        return Deployed({ledger: ledger, registry: registry, scorer: scorer, adapter: adapter});
    }

    /// @dev Standard ENS namehash: namehash("") = 0x0; namehash(a.b) =
    ///      keccak256(namehash(b) . keccak256(a)), applied right-to-left over labels.
    function _namehash(string memory name) internal pure returns (bytes32 node) {
        node = bytes32(0);
        bytes memory nameBytes = bytes(name);
        uint256 lastDot = nameBytes.length;
        for (uint256 i = nameBytes.length; i > 0; i--) {
            if (nameBytes[i - 1] == ".") {
                node = keccak256(abi.encodePacked(node, keccak256(_slice(nameBytes, i, lastDot))));
                lastDot = i - 1;
            }
        }
        node = keccak256(abi.encodePacked(node, keccak256(_slice(nameBytes, 0, lastDot))));
    }

    function _slice(bytes memory data, uint256 start, uint256 end) internal pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = data[i];
        }
    }
}
