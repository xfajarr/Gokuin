// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ProbeLedger} from "../src/ProbeLedger.sol";

contract ProbeLedgerTest is Test {
    ProbeLedger internal ledger;
    address internal prober = makeAddr("prober");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        ledger = new ProbeLedger(prober);
    }

    function _row(uint16 cycleId, uint32 routeId, bytes32 txHash) internal pure returns (ProbeLedger.Row memory) {
        return ProbeLedger.Row({
            mainnetTxHash: txHash,
            submittedBlock: 100,
            includedBlock: 102,
            leakedAtBlock: 0,
            extractedWei: 0,
            simOut: 1 ether,
            realOut: 1 ether,
            routeId: routeId,
            cycleId: cycleId,
            sandwiched: false
        });
    }

    // ── test_RecordAppendsOnly ──────────────────────────────────────────────
    // Asserts: no path mutates an existing row. There is no update/delete function at
    // all, so this test proves the only two rows that exist are exactly the two that
    // were appended, in order, with their original data intact.
    function test_RecordAppendsOnly() public {
        vm.startPrank(prober);
        ledger.commitCycle(1, keccak256("sched-1"), 2);
        uint256 id0 = ledger.record(1, _row(1, 0, keccak256("tx0")));
        uint256 id1 = ledger.record(1, _row(1, 0, keccak256("tx1")));
        vm.stopPrank();

        assertEq(id0, 0, "first row id");
        assertEq(id1, 1, "second row id");
        assertEq(ledger.rowCount(), 2, "row count after two records");

        (bytes32 hash0,,,,,,,,,) = ledger.rows(0);
        (bytes32 hash1,,,,,,,,,) = ledger.rows(1);
        assertEq(hash0, keccak256("tx0"), "row 0 unaltered");
        assertEq(hash1, keccak256("tx1"), "row 1 unaltered");

        uint256[] memory idx = ledger.rowsByRoute(0);
        assertEq(idx.length, 2);
        assertEq(idx[0], 0);
        assertEq(idx[1], 1);
    }

    // ── test_OnlyProberCanRecord ────────────────────────────────────────────
    // Asserts: any sender other than the immutable `prober` reverts `NotProber`, for
    // every write path, commit, record and reveal alike.
    function test_OnlyProberCanRecord() public {
        vm.prank(prober);
        ledger.commitCycle(1, keccak256("sched-1"), 1);

        vm.prank(stranger);
        vm.expectRevert(ProbeLedger.NotProber.selector);
        ledger.record(1, _row(1, 0, keccak256("tx0")));

        vm.prank(stranger);
        vm.expectRevert(ProbeLedger.NotProber.selector);
        ledger.commitCycle(2, keccak256("sched-2"), 1);

        vm.prank(stranger);
        vm.expectRevert(ProbeLedger.NotProber.selector);
        ledger.revealCycle(1, new uint32[](0), new uint64[](0), bytes32(0));
    }

    // ── test_IntegrityDetectsGap ────────────────────────────────────────────
    // Asserts: commit 10, publish 8 → `intact == false`. This is the demo's on-chain
    // proof that cherry-picking or omission leaves a permanent, visible trace.
    function test_IntegrityDetectsGap() public {
        vm.startPrank(prober);
        ledger.commitCycle(7, keccak256("sched-7"), 10);
        for (uint32 i = 0; i < 8; i++) {
            ledger.record(7, _row(7, i % 3, keccak256(abi.encodePacked("tx", i))));
        }
        vm.stopPrank();

        (uint16 committed, uint16 published, bool intact) = ledger.integrity(7);
        assertEq(committed, 10, "committed count");
        assertEq(published, 8, "published count");
        assertFalse(intact, "gap must be visible as non-intact");
    }

    // ── test_RevealValidatesSalt ────────────────────────────────────────────
    // Asserts: revealing with a salt that does not reproduce the committed schedule
    // hash reverts `BadSalt`; revealing with the correct salt succeeds and reports
    // `intact`.
    function test_RevealValidatesSalt() public {
        uint16 cycleId = 3;
        uint32[] memory routeIds = new uint32[](2);
        routeIds[0] = 0;
        routeIds[1] = 1;
        uint64[] memory slots = new uint64[](2);
        slots[0] = 1000;
        slots[1] = 1001;
        bytes32 correctSalt = keccak256("correct-salt");
        bytes32 scheduleHash = keccak256(abi.encode(cycleId, routeIds, slots, correctSalt));

        vm.startPrank(prober);
        ledger.commitCycle(cycleId, scheduleHash, 2);
        ledger.record(cycleId, _row(cycleId, 0, keccak256("txA")));
        ledger.record(cycleId, _row(cycleId, 1, keccak256("txB")));

        bytes32 wrongSalt = keccak256("wrong-salt");
        vm.expectRevert(ProbeLedger.BadSalt.selector);
        ledger.revealCycle(cycleId, routeIds, slots, wrongSalt);

        // The correct salt, against the same public routeIds/slots, must succeed.
        ledger.revealCycle(cycleId, routeIds, slots, correctSalt);
        vm.stopPrank();

        (bytes32 storedScheduleHash, bytes32 storedSalt,,,, bool revealed) = ledger.cycles(cycleId);
        assertEq(storedScheduleHash, scheduleHash);
        assertEq(storedSalt, correctSalt);
        assertTrue(revealed);
    }

    function test_RevealCycleRevertsIfAlreadyRevealed() public {
        uint16 cycleId = 4;
        uint32[] memory routeIds = new uint32[](0);
        uint64[] memory slots = new uint64[](0);
        bytes32 salt = keccak256("salt-4");
        bytes32 scheduleHash = keccak256(abi.encode(cycleId, routeIds, slots, salt));

        vm.startPrank(prober);
        ledger.commitCycle(cycleId, scheduleHash, 0);
        ledger.revealCycle(cycleId, routeIds, slots, salt);

        vm.expectRevert(ProbeLedger.AlreadyRevealed.selector);
        ledger.revealCycle(cycleId, routeIds, slots, salt);
        vm.stopPrank();
    }

    function test_CommitCycleRevertsIfAlreadyCommitted() public {
        vm.startPrank(prober);
        ledger.commitCycle(9, keccak256("sched-9"), 1);
        vm.expectRevert(ProbeLedger.CycleExists.selector);
        ledger.commitCycle(9, keccak256("sched-9-again"), 5);
        vm.stopPrank();
    }

    function test_RecordRevertsForUnknownCycle() public {
        vm.prank(prober);
        vm.expectRevert(ProbeLedger.CycleUnknown.selector);
        ledger.record(42, _row(42, 0, keccak256("tx")));
    }

    // ── test_RowPacking ─────────────────────────────────────────────────────
    // Gas snapshot + storage-slot assertion. `Row`'s field widths (fixed by
    // `packages/core/src/types.ts::Row`, which this struct mirrors field-for-field)
    // total 111 bytes, more than three 32-byte slots (96 bytes) can hold at any
    // packing, so the PRD's "three slots" note is unreachable at these widths. This
    // test asserts the layout is nonetheless as tight as those widths allow: exactly
    // four 32-byte slots, with the fifth slot after a single row entirely untouched.
    function test_RowPacking() public {
        vm.startPrank(prober);
        ledger.commitCycle(1, keccak256("sched-1"), 1);
        uint256 gasBefore = gasleft();
        ledger.record(
            1,
            ProbeLedger.Row({
                mainnetTxHash: keccak256("tx-packing"),
                submittedBlock: type(uint64).max,
                includedBlock: type(uint64).max,
                leakedAtBlock: type(uint64).max,
                extractedWei: type(uint128).max,
                simOut: type(uint128).max,
                realOut: type(uint128).max,
                routeId: type(uint32).max,
                cycleId: 1,
                sandwiched: true
            })
        );
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();
        emit log_named_uint("gas used by record() for one Row", gasUsed);

        // `rows` is the second storage variable declared (after the `cycles` mapping),
        // so its array-length slot is slot 1; element data begins at keccak256(1).
        bytes32 base = keccak256(abi.encode(uint256(1)));

        bytes32 slot0 = vm.load(address(ledger), base);
        assertEq(slot0, keccak256("tx-packing"), "slot 0: mainnetTxHash alone");

        bytes32 slot1 = vm.load(address(ledger), bytes32(uint256(base) + 1));
        assertEq(uint64(uint256(slot1)), type(uint64).max, "slot 1: submittedBlock");
        assertEq(uint64(uint256(slot1 >> 64)), type(uint64).max, "slot 1: includedBlock");
        assertEq(uint64(uint256(slot1 >> 128)), type(uint64).max, "slot 1: leakedAtBlock");
        assertEq(uint64(uint256(slot1 >> 192)), 0, "slot 1: top 8 bytes unused");

        bytes32 slot2 = vm.load(address(ledger), bytes32(uint256(base) + 2));
        assertEq(uint128(uint256(slot2)), type(uint128).max, "slot 2: extractedWei");
        assertEq(uint128(uint256(slot2 >> 128)), type(uint128).max, "slot 2: simOut, fills slot exactly");

        bytes32 slot3 = vm.load(address(ledger), bytes32(uint256(base) + 3));
        assertEq(uint128(uint256(slot3)), type(uint128).max, "slot 3: realOut");
        assertEq(uint32(uint256(slot3 >> 128)), type(uint32).max, "slot 3: routeId");
        assertEq(uint16(uint256(slot3 >> 160)), 1, "slot 3: cycleId");
        assertEq(uint8(uint256(slot3 >> 176)), 1, "slot 3: sandwiched (true)");

        bytes32 slot4 = vm.load(address(ledger), bytes32(uint256(base) + 4));
        assertEq(slot4, bytes32(0), "slot 4: untouched - Row uses exactly 4 slots, not 5");
    }
}
