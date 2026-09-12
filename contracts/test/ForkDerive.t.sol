// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

/// @notice Mainnet-fork pin for the `extractedWei` metric definition. Once wired up,
///         this forks mainnet at a known historical sandwich block and asserts
///         `simOut - realOut` — an `eth_call` replay of the victim's calldata against
///         state at `includedBlock - 1`, compared to the real receipt output — equals
///         the same value `packages/core/src/metrics.ts::computeExtracted()` produces
///         off-chain against the identical fixture, so the contract and the TypeScript
///         metric test can never silently disagree about what a sandwich cost.
/// @dev NEEDS `MAINNET_RPC` (an archive-capable mainnet RPC URL) **and** a pinned
///      known-sandwich fixture (block number, victim tx hash, expected extractedWei)
///      shared with the TS test — neither is wired up yet, so this always
///      self-skips via `vm.skip(true)` rather than failing the suite. To run it for
///      real once both exist:
///        `MAINNET_RPC=https://... forge test --match-test testFork_DeriveKnownSandwich --fork-url $MAINNET_RPC`
///      Implementation sketch for whoever picks this up:
///        1. `vm.createSelectFork(vm.envString("MAINNET_RPC"), KNOWN_SANDWICH_BLOCK - 1);`
///        2. Replay the victim's exact calldata (`address(victim.to).call(victim.data)`
///           via a static-call-style low-level call, or `vm.call`) to obtain `simOut`.
///        3. Read `realOut` from the pinned fixture (the actual receipt output at
///           `KNOWN_SANDWICH_BLOCK`) — the same fixture consumed by the TS test.
///        4. `assertEq(simOut - realOut, KNOWN_EXTRACTED_WEI);`
contract ForkDeriveTest is Test {
    function testFork_DeriveKnownSandwich() public {
        string memory rpc = vm.envOr("MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            emit log("skipped: MAINNET_RPC is not set");
            vm.skip(true);
            return;
        }

        // MAINNET_RPC is available, but the known-sandwich fixture (block, victim tx,
        // expected extractedWei) shared with packages/core's metric test is not yet
        // pinned in this file. Skip rather than fail until that fixture lands.
        emit log("skipped: known-sandwich fixture not yet pinned - see TODO in this file");
        vm.skip(true);
    }
}
