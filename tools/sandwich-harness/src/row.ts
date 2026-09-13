// Builds the exact `Row` shape (packages/core/src/types.ts) that
// apps/api/src/derive/settle.ts would produce for this probe once the
// subgraph has a verdict, with `staged: true`, because `probe.staged` is 1
// from the moment db.ts:registerStagedProbe inserted it (see
// apps/api/src/derive/settle.ts: `staged: probe.staged === 1`).
//
// This is the piece constraint 3 asks to verify end to end: not just "does
// scoreRoute() ignore a staged row in the abstract" (already covered by
// packages/core/test/staged-exclusion.test.ts), but "does OUR row, built
// from OUR real Sepolia hashes, actually carry staged=true and actually get
// excluded": see test/staged-row.test.ts.
import { ROUTE_IDS, type Row } from '../../../packages/core/src/index'

export interface StagedRowInputs {
  victimTxHash: `0x${string}`
  submittedBlock: number
  includedBlock: number
  cycleId: number
  /** Best-effort proxy, same convention as substreams' attackerRoundTripWei, not the ledger's simOut-realOut definition. See substreams/src/lib.rs comment on the same field. */
  extractedWei: bigint
  simOut: bigint
  realOut: bigint
}

/** Always builds with staged: true, this module has no code path that produces a staged: false row. That is intentional: everything this harness touches is, by definition, staged. */
export function buildStagedRow(inputs: StagedRowInputs): Row {
  return {
    mainnetTxHash: inputs.victimTxHash, // field name is inherited from ProbeLedger.Row; this harness runs on Sepolia, not mainnet, see README.md "on `mainnetTxHash`"
    submittedBlock: inputs.submittedBlock,
    includedBlock: inputs.includedBlock,
    leakedAtBlock: 0, // not measured by this harness, irrelevant to what it demonstrates
    extractedWei: inputs.extractedWei,
    simOut: inputs.simOut,
    realOut: inputs.realOut,
    routeId: ROUTE_IDS['public-mempool'],
    cycleId: inputs.cycleId,
    sandwiched: true,
    staged: true,
  }
}
