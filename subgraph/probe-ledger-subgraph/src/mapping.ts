import { BigInt, log } from "@graphprotocol/graph-ts";
import { RowRecorded, ProbeLedger } from "../generated/ProbeLedger/ProbeLedger";
import { Route, Row } from "../generated/schema";

// Mirrors packages/core/src/types.ts ROUTE_IDS exactly. `routeId` is the
// stable on-chain index ("never reorder", per that file's own comment);
// this array is the subgraph's copy of the same mapping, since an
// AssemblyScript mapping cannot import a TypeScript package at runtime.
// If ROUTE_IDS ever changes, this must change with it.
const ROUTE_LABELS: string[] = [
  "public-mempool", // 0
  "flashbots-protect", // 1
  "mev-blocker", // 2
];

function routeLabelForId(routeId: i32): string | null {
  if (routeId < 0 || routeId >= ROUTE_LABELS.length) {
    return null;
  }
  return ROUTE_LABELS[routeId];
}

function loadOrCreateRoute(label: string): Route {
  let route = Route.load(label);
  if (route == null) {
    route = new Route(label);
    route.probes = BigInt.zero();
    route.leaks = BigInt.zero();
    route.sandwiches = BigInt.zero();
    route.totalExtractedWei = BigInt.zero();
    route.medianDelayBlocks = 0;
    route.delayBlocksSamples = [];
  }
  return route as Route;
}

function medianOf(xs: i32[]): i32 {
  if (xs.length == 0) return 0;
  // .sort() on a copy -- AssemblyScript arrays sort in place, and `xs` here
  // is already the caller's own scratch copy (see call site).
  let sorted = xs.sort((a, b) => a - b);
  let mid = sorted.length / 2;
  if (sorted.length % 2 == 1) {
    return sorted[mid];
  }
  // Matches packages/core/src/metrics.ts median(): even-length case
  // averages the two middle values and rounds.
  return <i32>Math.round(<f64>(sorted[mid - 1] + sorted[mid]) / 2.0);
}

export function handleRowRecorded(event: RowRecorded): void {
  let routeLabel = routeLabelForId(event.params.routeId.toI32());
  if (routeLabel == null) {
    log.warning(
      "RowRecorded with unknown routeId {} (rowId {}) -- skipping, ROUTE_LABELS may be stale relative to packages/core/src/types.ts",
      [event.params.routeId.toString(), event.params.rowId.toString()]
    );
    return;
  }

  // Full row data (extractedWei, sandwiched, leaked, delay, etc.) is not in
  // the event itself -- only the pointer (rowId) is. We read it back via a
  // contract call to the public `rows(uint256)` array getter, per the
  // documented choice in ../README.md ("a contract call, not a second
  // event"): ProbeLedger already exposes `Row[] public rows` for free
  // (Solidity auto-generates this getter for any public array of
  // value-typed structs), so no contract change or extra event was needed
  // just to serve this subgraph.
  let contract = ProbeLedger.bind(event.address);
  let rowData = contract.rows(event.params.rowId);

  let route = loadOrCreateRoute(routeLabel as string);

  let row = new Row(event.params.rowId.toString());
  row.route = route.id;
  row.mainnetTxHash = rowData.getMainnetTxHash();
  row.includedBlock = rowData.getIncludedBlock();
  let leakedAtBlock = rowData.getLeakedAtBlock();
  row.leaked = !leakedAtBlock.isZero();
  row.sandwiched = rowData.getSandwiched();
  row.extractedWei = rowData.getExtractedWei();
  row.cycleId = rowData.getCycleId(); // already i32 -- graph-cli codegen returns uint16 tuple fields unboxed
  row.save();

  // delayBlocks = includedBlock - submittedBlock, floored at zero --
  // matches packages/core/src/metrics.ts delayBlocks() exactly.
  let delayBlocks = rowData.getIncludedBlock().minus(rowData.getSubmittedBlock());
  if (delayBlocks.lt(BigInt.zero())) {
    delayBlocks = BigInt.zero();
  }

  route.probes = route.probes.plus(BigInt.fromI32(1));
  if (row.leaked) {
    route.leaks = route.leaks.plus(BigInt.fromI32(1));
  }
  if (row.sandwiched) {
    route.sandwiches = route.sandwiches.plus(BigInt.fromI32(1));
  }
  route.totalExtractedWei = route.totalExtractedWei.plus(row.extractedWei);

  let samples = route.delayBlocksSamples;
  samples.push(delayBlocks.toI32());
  route.delayBlocksSamples = samples;
  route.medianDelayBlocks = medianOf(samples);

  route.save();
}
