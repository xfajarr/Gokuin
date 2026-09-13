// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Mainnet-fork pin for the `extractedWei` metric definition. Forks mainnet at
///         a known historical sandwich block and asserts `simOut - realOut`: an
///         on-chain replay of the victim's IDENTICAL calldata against state at
///         `includedBlock - 1`, compared to the victim's real, already-decoded output :
///         equals the same value `packages/core/src/metrics.ts::computeExtracted()`
///         produces off-chain against the identical fixture. PRD.md §15: "the fork test
///         and the TypeScript metric test consume the same fixture and must agree. If
///         the contract and the API disagree about what a sandwich cost, the project
///         has no product."
///
///         Every numeric/address constant below is a hardcoded copy of
///         `packages/core/src/fixtures.ts` (`KNOWN_SANDWICH` / `KNOWN_SANDWICH_DERIVED`)
///        : Solidity can't import TypeScript, so that file is the single source of
///         truth and this file must stay byte-identical to it. If you change one, change
///         the other and re-run both suites.
///
///         The real sandwich: Ethereum mainnet block 22450093, Uniswap V2 WETH/RATO
///         pool. The front-run (tx index 10) and back-run (tx index 12) are not replayed
///         here, the TS suite's structural-precondition tests already pin their shape
///         (i<j<k, same pool, same attacker, distinct hashes). This test only needs to
///         replay the victim's own transaction (tx index 11) against pre-front-run state
///         to derive `simOut`, since that is the only side of the `extractedWei`
///         calculation that requires an EVM replay rather than a log decode.
/// @dev NEEDS `MAINNET_RPC` (an archive-capable mainnet RPC URL: `eth.drpc.org` is
///      known to work for this exact block as of 2026-09). Without it, this test
///      self-skips via `vm.skip(true)` (that guard is legitimate: CI without network
///      access, or a rate-limited/down public RPC, should not fail the suite). With
///      MAINNET_RPC set, it MUST run and pass, there is no other skip condition.
///      Run it with:
///        `MAINNET_RPC=https://eth.drpc.org forge test --match-test testFork_DeriveKnownSandwich -vv`
contract ForkDeriveTest is Test {
    // --- packages/core/src/fixtures.ts::KNOWN_SANDWICH ----------------------------------

    uint256 constant SANDWICH_BLOCK = 22450093;

    address constant POOL = 0x8D02988296949cd054623802c1115973A9AFE307; // Uniswap V2 WETH/RATO
    address constant ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af; // victim's tx `to`
    address constant VICTIM_FROM = 0x589437c4e91029c830217890107AebB545768Dd3;

    bytes32 constant SWAP_TOPIC = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822;

    // Victim's transaction: 0x7c2d07b87c34605b08b15dccb9e01d403146b9c87d7c1b0ea3ce789a2f9b4252
    // (tx index 11 in block 22450093), replayed verbatim: same `to`, same `value`, same
    // calldata, from an impersonated `VICTIM_FROM`.
    uint256 constant VICTIM_VALUE_WEI = 830000000000000000; // 0.83 ETH
    bytes VICTIM_CALLDATA =
        hex"3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000681ec3ba00000000000000000000000000000000000000000000000000000000000000040b080604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000b84c09a3b930000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000b84c09a3b930000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000f816507e690f5aa4e29d164885eb5fa7a56278600000000000000000000000000000000000000000000000000000000000000060000000000000000000000000f816507e690f5aa4e29d164885eb5fa7a5627860000000000000000000000000000000fee13a103a10d593b9ae06b3e05f2e7e1c00000000000000000000000000000000000000000000000000000000000000190000000000000000000000000000000000000000000000000000000000000060000000000000000000000000f816507e690f5aa4e29d164885eb5fa7a5627860000000000000000000000000589437c4e91029c830217890107aebb545768dd3000000000000000000000000000000000000000000000000022da68b312a59900c";

    // --- packages/core/src/fixtures.ts::KNOWN_SANDWICH_DERIVED ---------------------------

    // realOut: RATO the victim actually received, decoded from the pool's Swap log in the
    // REAL block 22450093 (with the front-run already applied). Independently re-derived
    // via `cast logs`/`cast receipt`: see substreams/fixtures/known-sandwich.md.
    uint256 constant REAL_OUT = 157358171477322859;

    // extractedWei = simOut - realOut, floored at zero (mirrors computeExtracted() in
    // packages/core/src/metrics.ts). simOut is derived below by replay, not hardcoded
    // independently, so this constant is the assertion target, not an input.
    uint256 constant EXPECTED_EXTRACTED_WEI = 12913434669342331;

    function testFork_DeriveKnownSandwich() public {
        string memory rpc = vm.envOr("MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            emit log("skipped: MAINNET_RPC is not set");
            vm.skip(true);
            return;
        }

        // Fork at includedBlock - 1: state exactly as it was right before block
        // 22450093 executed, i.e. before the front-run, the victim's own tx, and the
        // back-run all ran. Replaying the victim's tx here isolates what they would
        // have received had nobody sandwiched them.
        vm.createSelectFork(rpc, SANDWICH_BLOCK - 1);

        vm.deal(VICTIM_FROM, 10 ether);
        vm.recordLogs();
        vm.prank(VICTIM_FROM);
        (bool ok,) = ROUTER.call{value: VICTIM_VALUE_WEI}(VICTIM_CALLDATA);
        assertTrue(ok, "victim replay reverted against pre-front-run state");

        uint256 simOut = _decodeAmount1OutFromPool();

        uint256 extractedWei = simOut > REAL_OUT ? simOut - REAL_OUT : 0;

        assertEq(extractedWei, EXPECTED_EXTRACTED_WEI, "simOut - realOut must match packages/core's fixture");
    }

    /// @dev Scans the logs recorded during the replay for the pool's Swap event and
    ///      decodes `amount1Out` (RATO, token1): the amount the pool sent to the router
    ///      for the victim's swap, absent any front-run.
    function _decodeAmount1OutFromPool() internal returns (uint256 amount1Out) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == POOL && logs[i].topics.length > 0 && logs[i].topics[0] == SWAP_TOPIC) {
                (,, uint256 a0Out, uint256 a1Out) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                // token0 is WETH, token1 is RATO, the victim swaps WETH -> RATO, so the
                // pool's output leg is amount1Out.
                assertEq(a0Out, 0, "expected a WETH-in / RATO-out swap (amount0Out should be zero)");
                amount1Out = a1Out;
                found = true;
            }
        }
        assertTrue(found, "no Swap log emitted by POOL during the replay");
    }
}
