# Architecture

## What the system does, in one pass

A **cycle** is one round of measurement. It commits to a schedule, sends twin
transactions down competing routes, watches what happens to each, derives what it
cost, and writes a row that points at the evidence.

```
  1  commit    schedule hash + probe count → Sepolia, BEFORE anything is sent
  2  fund      distributor tops up a fresh EOA per probe, varied amounts
  3  dispatch  one swap, built once, submitted identically to two routes
  4  observe   listeners in two regions sign what they saw and when
  5  block     Substreams scans for the one-block sandwich pattern
  6  derive    eth_call at includedBlock-1 vs the receipt → extractedWei
  7  record    a Row lands in ProbeLedger, pointing at the mainnet hash
  8  score     CRE applies secret weights in a TEE → ENS text records
  9  reveal    salt published; committed count must equal published rows
```

Step 1 before step 3 is a hard ordering constraint, not a convention. A commit
that lands after dispatch proves nothing at all.

## Components

| Path | Runtime | Responsibility |
|---|---|---|
| `packages/core` | TypeScript | measurement definitions. Imported by everything else |
| `packages/abi` | generated | typed ABIs from `forge build`. Never hand-written |
| `contracts/` | Solidity, Sepolia | `ProbeLedger`, `RouteRegistry` (ENSv2), `Scorer` |
| `substreams/` | Rust → WASM | `sandwich-detect`, generic over any address |
| `subgraph/` | AssemblyScript | two subgraphs — see below |
| `apps/api` | Bun + ElysiaJS | cycle orchestration, observation ingest, scoring reads |
| `apps/listener` | Bun | standalone mempool watcher, one process per region |
| `apps/web` | TanStack Start | scoreboard, probe detail, method, console |
| `apps/mcp` | Bun | `gokuin_submit` / `routes` / `explain` |
| `cre/` | Chainlink CRE | confidential scoring |

## Three structural decisions

### Probes on mainnet, contracts on Sepolia

A sandwich on a testnet proves nothing — there are no searchers there to do the
sandwiching, and a measurement of an empty market measures nothing. Probes
therefore run on **mainnet**.

ENSv2 is Sepolia-only during its beta, and the route registry is an ENSv2 feature.
So the contracts live on **Sepolia**, and every row carries the **mainnet**
transaction hash it indexes.

> The evidence is the mainnet hash. Where we index it does not change what anyone
> can verify.

### One definition of every metric, imported everywhere

`packages/core/src/metrics.ts` is the only place a metric is defined. The API, the
MCP server, the web UI and the documentation all read from it:

- `docs/metrics.md` is **generated** from that file
- `/method` renders its definitions by **calling** those functions at render time
- `/probe/$id`'s provenance column is driven off `Object.keys(PROVENANCE)`
- `contracts/test/ForkDerive.t.sol` and `packages/core/test/sandwich-fixture.test.ts`
  consume the same verified historical sandwich and must agree

If the contract and the API disagree about what a sandwich cost, the project has
no product. That disagreement is made to fail a test rather than reach production.

Two constants cannot be imported and so are duplicated. Both are guarded:

- the **ABI** — generated from `forge build`, with `apps/api/test/abi-drift.test.ts`
  encoding every ledger write and explicitly rejecting the old signature that
  already drifted here once
- the **routeId → label map** — restated in AssemblyScript because AS cannot import
  TypeScript, with `packages/core/test/route-label-drift.test.ts` reading the AS
  source and asserting agreement

Both guards exist because both bugs are silent. A drifted ABI reverts at broadcast,
not at compile time. A drifted route map attributes every probe to the wrong route
and makes the whole scoreboard wrong with no symptom.

### Scores come from the subgraph, never from SQLite

`apps/api/src/score/read.ts` queries the subgraph over GraphQL and throws
`ScoreReadUnavailable` if it cannot. It does not fall back to the local database.

SQLite holds operational state — probes, observations, funding — and nothing that
appears on the scoreboard. Unset `SUBGRAPH_URL` and `/v1/routes` returns 503 with
*"no Graph, no scores"*.

That is what makes "The Graph is load-bearing" a demonstrable property rather than
a sentence in a submission form. You can turn it off and watch the scores vanish.

## Two subgraphs, not one

Forced by GIP-0053: a subgraph with a `substreams` dataSource may have only that
single dataSource. Mainnet sandwich detection therefore cannot share a manifest
with the Sepolia `ProbeLedger` contract datasource.

- `subgraph/sandwich-subgraph` — substreams datasource, mainnet, `Sandwich` entities
- `subgraph/probe-ledger-subgraph` — `ethereum/contract` datasource, Sepolia,
  `Route` and `Row` entities from `RowRecorded`, with full row data read back via
  `ProbeLedger`'s public `rows(uint256)` getter

## Dry-run is a code path, not a stub

Where a live key or endpoint is absent, the code still does the real encoding and
signing and skips only the network call, logging the fact clearly:

- no `PROBER_PK` or `PROBE_LEDGER_ADDRESS` → ledger writes encode for real, then
  hash the calldata into a labelled stand-in
- no `MAINNET_WS` → the listener replays a labelled fixture stream through the
  identical sign / filter / post path
- no `DISTRIBUTOR_PK` → funding builds and signs, skipping broadcast

This is deliberate. A stub exercises different code than production does, so it
proves nothing; a dry run exercises the same code minus one call.

The exception is `/console`. It claims to be running a live probe, so it never
falls back to sample data — it shows the failure instead. Read-only pages may fall
back, always behind a visible `SAMPLE DATA` banner.
