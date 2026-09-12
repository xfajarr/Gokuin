// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ProbeLedger
/// @notice Append-only index into public evidence. Stores no opinion.
/// @dev Every field on `Row` is either the mainnet transaction hash a claim can be
///      re-derived from, or a number computed from public block data by the API and
///      pinned here so it cannot be revised after the fact. There is no `update`, no
///      `delete`, no owner, and no upgrade proxy — immutability is the product.
///
///      Mirrors `packages/core/src/types.ts` `Row` field-for-field and in the same
///      order; mirrors `packages/core/src/schedule.ts` `hashSchedule()` exactly for the
///      commit/reveal hash so the API and the contract can never disagree about what a
///      cycle committed to.
contract ProbeLedger {
    /// @notice One probe's settled result. Mirrors `packages/core/src/types.ts::Row`.
    /// @dev Field order is fixed to match the TypeScript type and must not be reordered.
    ///      Solidity packs sequential fields into a slot only while they fit, so this
    ///      layout occupies four 32-byte slots, not three: `mainnetTxHash` alone fills
    ///      slot 0; `submittedBlock`/`includedBlock`/`leakedAtBlock` (8+8+8 = 24 bytes)
    ///      share slot 1 with 8 bytes unused, because the next field, `extractedWei`
    ///      (16 bytes), does not fit in the remainder and starts slot 2 instead;
    ///      `extractedWei`/`simOut` (16+16 = 32 bytes) exactly fill slot 2;
    ///      `realOut`/`routeId`/`cycleId`/`sandwiched` (16+4+2+1 = 23 bytes) share slot
    ///      3. The struct carries 111 bytes of real data, which cannot fit in three
    ///      32-byte (96-byte) slots at these field widths no matter how it is packed —
    ///      this is the tightest layout the given field order and types allow.
    struct Row {
        bytes32 mainnetTxHash; // the evidence; everything else is derived from it
        uint64 submittedBlock;
        uint64 includedBlock;
        uint64 leakedAtBlock; // 0 = not leaked
        uint128 extractedWei;
        uint128 simOut;
        uint128 realOut;
        uint32 routeId;
        uint16 cycleId;
        bool sandwiched;
    }

    /// @notice Commit/reveal bookkeeping for one cycle.
    struct Cycle {
        bytes32 scheduleHash;
        bytes32 salt; // 0 until revealed
        uint16 committedCount;
        uint16 publishedCount;
        uint64 committedAt;
        bool revealed;
    }

    /// @notice The single address permitted to commit, record and reveal. Immutable —
    ///         it cannot be rotated. If the key is lost, deploy a new ledger and say so.
    address public immutable prober;

    /// @notice Cycle metadata by cycle id.
    mapping(uint16 => Cycle) public cycles;

    /// @notice Every probe result ever recorded, in the order it was recorded.
    Row[] public rows;

    /// @dev routeId => indices into `rows`. Exposed read-only via `rowsByRoute`.
    mapping(uint32 => uint256[]) internal _rowsByRoute;

    event CycleCommitted(uint16 indexed cycleId, bytes32 scheduleHash, uint16 count);
    event CycleRevealed(uint16 indexed cycleId, bytes32 salt, uint16 published, bool intact);
    event RowRecorded(uint16 indexed cycleId, uint32 indexed routeId, uint256 rowId, bytes32 mainnetTxHash);

    error NotProber();
    error CycleExists();
    error CycleUnknown();
    error AlreadyRevealed();
    error BadSalt();

    modifier onlyProber() {
        if (msg.sender != prober) revert NotProber();
        _;
    }

    /// @param prober_ the only address ever permitted to write to this ledger.
    constructor(address prober_) {
        prober = prober_;
    }

    /// @notice Post the schedule hash BEFORE any probe is dispatched.
    /// @dev `scheduleHash` must equal `hashSchedule()` in `packages/core/src/schedule.ts`
    ///      for the same `(cycleId, routeIds, slots, salt)` — verified on `revealCycle`,
    ///      not here, since the routes and slots are not yet known to be final at commit
    ///      time in the sense the contract can check; only the hash is fixed.
    /// @param cycleId identifies this cycle; must not already be committed.
    /// @param scheduleHash keccak256 commitment produced by `hashSchedule()` off-chain.
    /// @param count number of probes the schedule intends to run; compared against
    ///        `publishedCount` by `integrity()` once probes are recorded.
    function commitCycle(uint16 cycleId, bytes32 scheduleHash, uint16 count) external onlyProber {
        if (cycles[cycleId].committedAt != 0) revert CycleExists();
        cycles[cycleId] = Cycle({
            scheduleHash: scheduleHash,
            salt: bytes32(0),
            committedCount: count,
            publishedCount: 0,
            committedAt: uint64(block.timestamp),
            revealed: false
        });
        emit CycleCommitted(cycleId, scheduleHash, count);
    }

    /// @notice Append one probe result. Never updated, never deleted.
    /// @dev Reverts `CycleUnknown` if `cycleId` was never committed, or if
    ///      `row.cycleId` disagrees with `cycleId` — the two must always match, since a
    ///      row belongs to exactly one committed cycle.
    /// @param cycleId the cycle this row belongs to; must already be committed.
    /// @param row the settled probe result, composed off-chain by `derive/settle.ts`.
    /// @return rowId the index of the new row in `rows` — stable forever, used as the
    ///         subgraph `Row.id` and in `RowRecorded`.
    function record(uint16 cycleId, Row calldata row) external onlyProber returns (uint256 rowId) {
        Cycle storage c = cycles[cycleId];
        if (c.committedAt == 0) revert CycleUnknown();
        if (row.cycleId != cycleId) revert CycleUnknown();

        rows.push(row);
        rowId = rows.length - 1;
        _rowsByRoute[row.routeId].push(rowId);
        c.publishedCount += 1;

        emit RowRecorded(cycleId, row.routeId, rowId, row.mainnetTxHash);
    }

    /// @notice Reveal the salt. Anyone can now recompute the schedule and compare counts.
    /// @dev Recomputes `keccak256(abi.encode(cycleId, routeIds, slots, salt))` and
    ///      reverts `BadSalt` unless it matches the hash committed in `commitCycle`.
    ///      This is intentionally a wider signature than the PRD's two-argument sketch
    ///      (`revealCycle(cycleId, salt)`): the schedule hash cannot be verified
    ///      on-chain without the preimage it was built from, so `routeIds` and `slots`
    ///      — both public once probes are dispatched — must be supplied here to let the
    ///      contract itself prove the salt is genuine rather than merely storing it.
    /// @param cycleId the cycle to reveal; must be committed and not yet revealed.
    /// @param routeIds the schedule's route ids, in the exact order `hashSchedule()` used.
    /// @param slots the schedule's target block numbers, in the exact order used.
    /// @param salt the withheld salt from the original commitment.
    function revealCycle(uint16 cycleId, uint32[] calldata routeIds, uint64[] calldata slots, bytes32 salt)
        external
        onlyProber
    {
        Cycle storage c = cycles[cycleId];
        if (c.committedAt == 0) revert CycleUnknown();
        if (c.revealed) revert AlreadyRevealed();

        bytes32 recomputed = keccak256(abi.encode(cycleId, routeIds, slots, salt));
        if (recomputed != c.scheduleHash) revert BadSalt();

        c.salt = salt;
        c.revealed = true;

        bool intact = c.publishedCount == c.committedCount;
        emit CycleRevealed(cycleId, salt, c.publishedCount, intact);
    }

    /// @notice committed vs published — a gap is visible to everyone, forever.
    /// @dev Available as soon as a cycle is committed; does not require `revealCycle`
    ///      to have run, since the gap it detects (dispatched-but-never-recorded probes)
    ///      is independent of whether the salt has been published yet.
    /// @param cycleId the cycle to inspect.
    /// @return committed the count posted at `commitCycle` time.
    /// @return published the number of rows actually recorded for this cycle.
    /// @return intact true iff `committed == published`.
    function integrity(uint16 cycleId) external view returns (uint16 committed, uint16 published, bool intact) {
        Cycle storage c = cycles[cycleId];
        if (c.committedAt == 0) revert CycleUnknown();
        committed = c.committedCount;
        published = c.publishedCount;
        intact = committed == published;
    }

    /// @notice All row indices ever recorded for a given route, in recording order.
    /// @param routeId the on-chain route id (see `packages/core/src/types.ts::ROUTE_IDS`).
    function rowsByRoute(uint32 routeId) external view returns (uint256[] memory) {
        return _rowsByRoute[routeId];
    }

    /// @notice Total number of rows ever recorded, across every route and cycle.
    function rowCount() external view returns (uint256) {
        return rows.length;
    }
}
