# subgraph/

Two separate subgraphs, not one. That split is forced by The Graph itself,
not a style choice:

> "Subgraphs with a substreams dataSource can only have that single
> dataSource." -- [GIP-0053](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0053-enabling-substreams-based-subgraphs.md)

Since the generic sandwich detector is a `kind: substreams` datasource, it
cannot share a manifest with a normal `kind: ethereum/contract` datasource
for Sepolia's `ProbeLedger`. So:

| | `sandwich-subgraph/` | `probe-ledger-subgraph/` |
|---|---|---|
| Datasource kind | `substreams` (reads `../../substreams`'s `graph_out` module) | `ethereum/contract` |
| Network | mainnet | sepolia |
| Entities | `Sandwich` | `Route`, `Row` |
| Populated from | every Uniswap V2/V3 pool, every block, any address | `RowRecorded` events on Gokuin's own `ProbeLedger` |
| Answers | "was `0x...` ever sandwiched, by anyone, anywhere?" | "how does route X score across Gokuin's own probes?" |

Together they still satisfy The Graph's "compose 2+ Graph products"
requirement -- Substreams + a Substreams-powered subgraph, plus a second,
conventional subgraph, all open source, all queried live in the demo. The
backend and MCP server (per PRD.md §13) query both endpoints and join
client-side when they need to cross-reference (e.g. "was this specific
probe's mainnet tx a match for a `Sandwich.id`?" -- compare
`Row.mainnetTxHash` against `Sandwich.id` across the two subgraphs' query
results).

## Codegen, build, deploy

Each subgraph is self-contained; run these from inside its own directory.

```bash
cd sandwich-subgraph
# No `graph codegen`/`graph build` needed for a pure substreams/graph-entities
# datasource -- there is no AssemblyScript mapping to compile. `graph deploy`
# uploads subgraph.yaml + schema.graphql + the referenced .spkg (built and
# packed first -- see ../substreams/README.md) straight to Subgraph Studio.
graph deploy --studio gokuin-sandwich-detect

cd ../probe-ledger-subgraph
npm install
npm run codegen   # graph codegen -- generates ProbeLedger.ts bindings + schema types
npm run build     # graph build   -- compiles src/mapping.ts to WASM
npm run deploy    # graph deploy --studio gokuin-probe-ledger
```

Before deploying `probe-ledger-subgraph`, fill in the two `TODO(contracts)`
markers in its `subgraph.yaml` (`source.address`, `source.startBlock`) once
`ProbeLedger.sol` is deployed to Sepolia -- it's being written in parallel
with this subgraph, per the brief, so this repo cannot know its address
yet.

## GraphQL query shapes the backend/MCP should use

```graphql
# sandwich-subgraph -- "was this address ever sandwiched, or did it ever
# run the sandwich play, anywhere, by anyone?"
{
  sandwiches(where: { victim: "0xTARGET" }, orderBy: block, orderDirection: desc) {
    id block pool attacker frontrunTx backrunTx attackerRoundTripWei detectedBy
  }
}
```

```graphql
# probe-ledger-subgraph -- route scores, the API/MCP's primary read (PRD
# §12: "Graph load-bearing for the AI track ... API and MCP read scores
# only from the Subgraph. No Graph, no scores.")
{
  routes {
    id probes leaks sandwiches totalExtractedWei medianDelayBlocks
  }
  route(id: "mev-blocker") {
    probes leaks sandwiches totalExtractedWei medianDelayBlocks
    rows(orderBy: includedBlock, orderDirection: desc, first: 20) {
      mainnetTxHash includedBlock leaked sandwiched attackerRoundTripWei cycleId
    }
  }
}
```

`leakBps` / `sandwichBps` / `lastCycle` (present on `RouteScore` in
`packages/core/src/types.ts`) are intentionally NOT stored fields here --
PRD.md §5's `Route` entity doesn't list them, and they're trivially
derivable client-side from `probes`/`leaks`/`sandwiches`/the max `cycleId`
across `rows`, exactly the way `packages/core/src/metrics.ts`'s
`scoreRoute()` already computes them from `Row[]`. Keeping the stored
schema minimal and exactly matching PRD.md §5 was judged cleaner than
duplicating derived fields on-chain-of-truth in two places.

## Known simplification: `medianDelayBlocks`

AssemblyScript subgraph mappings cannot query a `@derivedFrom` relation
(`Route.rows`) while indexing -- only `Entity.load(id)` by known id is
available. So `Route.medianDelayBlocks` is maintained by growing an
internal `delayBlocksSamples: [Int!]!` array field on `Route` by one
element per `RowRecorded`, and fully re-sorting it every time (see
`probe-ledger-subgraph/src/mapping.ts`). This gives an exact median (no
approximation), at O(n log n) per row -- entirely fine at hackathon/demo
probe volumes (tens to low thousands of rows). If this ever needs to
scale further, swap it for a running two-heap median structure without
changing the public schema.
