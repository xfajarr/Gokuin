// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ProbeLedger} from "../src/ProbeLedger.sol";
import {RouteRegistry} from "../src/RouteRegistry.sol";
import {Scorer} from "../src/Scorer.sol";
import {ScorerReportReceiver} from "../src/ScorerReportReceiver.sol";

/// @notice The deploy script predicts two addresses from nonce arithmetic and wires
///         four contracts in an order where a mistake fails silently rather than
///         reverting. Reasoning about the nonce math is not evidence; running it is.
contract DeployTest is Test {
    Deploy script;

    address constant PROBER = address(0xB0B);
    address constant CHAINLINK_FORWARDER = address(0xF0);
    // Real ENSv2 ETHRegistry on Sepolia; the deploy script never calls it, only stores it as
    // RouteRegistry metadata, so a plain address stand-in is enough here.
    address constant ETH_REGISTRY = address(0xE7E9);

    function setUp() public {
        script = new Deploy();
        vm.setEnv("PROBER_ADDRESS", vm.toString(PROBER));
        vm.setEnv("CRE_FORWARDER", vm.toString(CHAINLINK_FORWARDER));
        vm.setEnv("ETH_REGISTRY", vm.toString(ETH_REGISTRY));
    }

    function test_ScriptRunsAndPredictionsHold() public {
        // Both `require`s inside the script assert the predicted addresses matched.
        Deploy.Deployed memory d = script.deploy(address(script));
        assertTrue(address(d.ledger) != address(0));
        assertTrue(address(d.adapter) != address(0));
    }

    function test_ScorerPointsAtTheAdapterNotChainlinksForwarder() public {
        Deploy.Deployed memory d = script.deploy(address(script));

                
        // The mistake this catches: pointing Scorer at Chainlink's raw Forwarder.
        // Nothing reverts at deploy time; every confidential score is simply rejected
        // forever, and you find out on camera.
        assertEq(d.scorer.creForwarder(), address(d.adapter), "Scorer must accept the adapter");
        assertTrue(d.scorer.creForwarder() != CHAINLINK_FORWARDER, "must NOT be the raw Forwarder");
        assertEq(d.adapter.forwarder(), CHAINLINK_FORWARDER, "adapter must accept Chainlink");
        assertEq(address(d.adapter.scorer()), address(d.scorer), "adapter must drive this Scorer");
    }

    function test_RegistryAcceptsOnlyTheScorer() public {
        Deploy.Deployed memory d = script.deploy(address(script));


        assertEq(d.registry.scorer(), address(d.scorer), "exactly one authorized writer, and it is the Scorer");
    }

    function test_RegistryPointsAtTheRealEthRegistryAndGokuinLabel() public {
        Deploy.Deployed memory d = script.deploy(address(script));

        assertEq(d.registry.ethRegistry(), ETH_REGISTRY, "must store the ETHRegistry it was deployed against");
        assertEq(d.registry.parentLabel(), "gokuin", "default parent label must be gokuin");
    }

    function test_LedgerProberIsTheConfiguredAddress() public {
        Deploy.Deployed memory d = script.deploy(address(script));
                assertEq(d.ledger.prober(), PROBER);
    }

    function test_DeployDoesNotRegisterRoutes() public {
        // Registration needs an owner the contracts cannot grant themselves, and a
        // revert there used to roll back all four deployments. It lives in
        // RegisterRoutes now; the deploy must stay independent of ENS state.
        Deploy.Deployed memory d = script.deploy(address(script));
        assertEq(d.registry.nodeOf(0), bytes32(0), "deploy must not touch ENS");
    }
}
