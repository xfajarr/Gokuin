# @gokuin/api

ElysiaJS (Bun) backend for Gokuin. Orchestrates probe cycles, ingests signed
observations from `apps/listener`, derives measurements, writes them to
`ProbeLedger` on Sepolia, and serves scores read live from the Subgraph.

See `PRD.md` §5, §7, §11, §12 at the repo root for the full spec this
implements. Metric definitions (`isLeaked`, `computeExtracted`, `delayBlocks`,
`scoreRoute`) live in `packages/core` and are imported here, never redefined.

## Running

```bash
bun install                 # from repo root (workspaces)
bun --filter @gokuin/api dev   # watch mode
bun --filter @gokuin/api start # once
bun test                    # from apps/api, or `bun test apps/api` from root
```

The server binds `PORT` (default `3000`) and prints its dry-run status on boot:

```
gokuin api listening on :3000 [ledger dry-run: no PROBER_PK/PROBE_LEDGER_ADDRESS configured] [no SUBGRAPH_URL: /v1/routes* will 503]
```

## Environment

All variables from the repo-root `.env.example`, plus a few optional
extensions. Everything that gates a live chain call is optional — when it is
absent, the relevant module runs in a clearly-labelled **dry-run / fixture
mode** instead of being stubbed out: calldata is still real ABI-encoded
bytes, transactions are still really signed, they are just not broadcast, and
a deterministic stand-in hash (`keccak256(calldata)` / `keccak256(signedTx)`)
is returned and logged with a `[dry-run]` prefix so it is never mistaken for
a real chain result.

| Var | Required for | Default / fallback |
|---|---|---|
| `MAINNET_RPC` | probe dispatch, simulation | `http://127.0.0.1:8545` (fixture) |
| `MAINNET_WS` | mainnet client uses websocket instead of http when set | — |
| `SEPOLIA_RPC` | ProbeLedger reads/writes | `http://127.0.0.1:8545` (fixture) |
| `PROBER_PK` | ProbeLedger writes to actually broadcast | absent → ledger dry-run |
| `SCORER_PK` | reserved for the CRE/Scorer flow (not driven from this API) | — |
| `LISTENER_PK` | dev-mode fallback listener allowlist (see below) | — |
| `LISTENER_REGION` | unused by the API itself (listener-side) | `eu-central` |
| `API_URL` | unused by the API itself (listener/mcp-side) | `http://localhost:3000` |
| `API_ADMIN_TOKEN` | `/admin/*` bearer auth | absent → admin routes 500 |
| `SUBGRAPH_URL` | **all `/v1/routes*` and `/v1/select` reads** | absent → those routes 503 |
| `PROBE_LEDGER_ADDRESS` | ledger writes/`integrity()` reads | absent → ledger dry-run |
| `ROUTE_REGISTRY_ADDRESS` | reserved (ENS registry not driven from this API yet) | — |
| `SCORER_ADDRESS` | reserved | — |
| `ALLOWED_LISTENER_ADDRESSES` *(extension)* | multi-listener signer allowlist, comma-separated | falls back to the address derived from `LISTENER_PK` |
| `FLASHBOTS_PROTECT_RPC` *(extension)* | the `flashbots-protect` route's transport | `https://rpc.flashbots.net/fast` |
| `MEV_BLOCKER_RPC` *(extension)* | the `mev-blocker` route's transport | `https://rpc.mevblocker.io` |
| `DB_PATH` *(extension)* | sqlite file location | `gokuin.db` (use `:memory:` in tests) |
| `PORT` *(extension)* | http port | `3000` |

**Assumption on the listener allowlist:** the PRD's `.env.example` has no
dedicated multi-signer allowlist variable. `ALLOWED_LISTENER_ADDRESSES` is an
additive, optional variable for the real two-region deployment; a single dev
listener can rely on `LISTENER_PK` alone. Document the real EU/US listener
addresses there before running two regions for real.

**Assumption on dispatch funding:** PRD §18 defers funding the rotated,
single-use probe EOAs to "a distributor," out of this task's scope. Signing
and calldata-encoding in `cycle/dispatch.ts` are fully real; broadcasting an
unfunded EOA's transaction to a live mainnet node will revert for
insufficient funds exactly like any other unfunded account would. Wire a
funder before running cycles against real mainnet routes.

## Module map (matches PRD §7.1)

```
src/
├── index.ts              Elysia app composition, .listen(), exports `App`
├── env.ts                typed env (TypeBox)
├── db.ts                 bun:sqlite schema + prepared statements
├── context.ts            AppContext DI container
├── chain/
│   ├── clients.ts         viem mainnet public client, sepolia public+wallet client
│   ├── routes.ts          route registry: name -> transport + capabilities
│   └── ledger.ts          ProbeLedger ABI + dry-run-aware writes
├── cycle/
│   ├── schedule.ts        build + hash the schedule (@gokuin/core hashSchedule)
│   ├── order-guard.ts     hard commit-before-dispatch enforcement
│   ├── dispatch.ts        rotate EOA, build twin swap calldata, submit
│   ├── reveal.ts          publish salt, assert published == committed
│   └── run.ts             the full 9-step orchestration (PRD §7.3)
├── observe/
│   ├── canonical.ts       canonical message format (mirrors apps/listener)
│   └── ingest.ts          verify listener signature + allowlist, store
├── derive/
│   ├── simulate.ts        eth_call at includedBlock-1; real payout from receipt logs
│   ├── sandwich.ts        GraphQL to the Subgraph for the sandwich verdict
│   └── settle.ts          compose Row, write to ProbeLedger
├── score/
│   ├── read.ts            GraphQL reads from the Subgraph (never SQLite)
│   └── select.ts          POST /v1/select ranking + reason/evidence
└── routes/
    ├── schemas.ts         TypeBox response shapes
    ├── public.ts          GET endpoints
    ├── listener.ts        POST /v1/observations
    └── admin.ts           POST /admin/cycles/run
```

## API surface

Base URL: `http://localhost:${PORT}` (default `3000`).

### `GET /health`
```json
{ "ok": true, "ledgerDryRun": true, "subgraphConfigured": false }
```

### `GET /v1/routes`
All routes' scores, read live from the Subgraph. **503** if `SUBGRAPH_URL` is unset or unreachable.
```json
[
  {
    "route": "flashbots-protect",
    "probes": 10, "leaks": 1, "leakBps": 1000,
    "sandwiches": 0, "sandwichBps": 0,
    "medianDelayBlocks": 2,
    "totalExtractedWei": "500",
    "lastCycle": 3
  }
]
```

### `GET /v1/routes/:id`
One route's score. `id` is a `RouteId` (`public-mempool` | `flashbots-protect` | `mev-blocker`). 404 if unknown, 503 if the subgraph is unavailable.

### `GET /v1/routes/:id/rows?limit=50&cursor=<id>`
Paginated evidence rows for one route, straight from the Subgraph's `Row` entity.
```json
{ "rows": [{ "id": "...", "mainnetTxHash": "0x..", "includedBlock": "19000010", "leaked": false, "sandwiched": false, "extractedWei": "0", "cycleId": 3 }], "nextCursor": "row-51" }
```

### `GET /v1/probes/:id`
One probe's local metadata (SQLite): the probe row, its twin (the paired probe sharing `twin_group`), raw observations, and its derivation row if settled. 404 if unknown.

### `GET /v1/cycles/:id/integrity`
Committed vs published counts. Reads `ProbeLedger.integrity()` on-chain when a ledger address is configured; falls back to a local SQLite tally (`source: "sqlite-dry-run"`) otherwise. 404 if the cycle is unknown.
```json
{ "committed": 10, "published": 10, "intact": true, "source": "ledger" }
```

### `GET /v1/watchlist`
The current cycle's watchlist — pending, non-`public-mempool` probe tx hashes. This is what `apps/listener` polls at cycle start (and on a refresh interval) so it only forwards hashes it should be watching for (PRD §7.4).
```json
{ "txHashes": ["0x.."] }
```

### `POST /v1/select` — **the product**
```jsonc
// request
{ "need": "privacy" | "speed" | "inclusion" | "cheap", "maxLeakBps"?: number, "maxWaitBlocks"?: number }
```
```json
// response
{
  "route": "flashbots-protect",
  "reason": "flashbots-protect leaked 1 of 10 probes (10.00%) and was sandwiched 0 times, the best measured leak rate of the routes probed. — the runner-up, mev-blocker, scored worse on leak rate.",
  "evidence": [{ "txHash": "0xfeed..", "what": "included cleanly at block 19000010, no leak or sandwich" }],
  "runnerUp": "mev-blocker"
}
```
`reason` is always a human-readable sentence; `evidence` always cites real tx hashes pulled from the Subgraph's `Row` entity for the winning route. 503 if the subgraph has no scored routes yet.

### `POST /v1/observations` — the only write path from outside
```jsonc
// request (sent by apps/listener, signed)
{ "txHash": "0x..", "region": "eu-central", "firstSeen": 1730000000000, "seenBlock": 19000000, "fromUncle": false, "signature": "0x.." }
```
Verifies the signature by recovering the signer over the canonical message `gokuin.observation:<txHash>:<region>:<firstSeen>:<seenBlock>` and checking it against the allowlist (`ALLOWED_LISTENER_ADDRESSES`, falling back to the address derived from `LISTENER_PK`). **401** `{ "error": "unrecognised listener" }` if the signer isn't allowlisted or the signature doesn't recover. On success:
```json
{ "stored": true, "probeId": 42 }
```
or, if no tracked probe matches the tx hash (e.g. a stray watchlist entry):
```json
{ "stored": false, "reason": "no probe tracks this tx hash" }
```

### `POST /admin/cycles/run` — bearer auth (`Authorization: Bearer $API_ADMIN_TOKEN`)
Drives the full cycle orchestration (PRD §7.3): build schedule → commit on Sepolia → **only then** dispatch the twin swap to two routes → settle whatever has been included → reveal the salt.
```jsonc
// request
{ "cycleId": 1, "pool": "0x..", "router": "0x..", "amountInWei": "1000000000000000", "slippageBps": 800 }
```
```json
// response
{ "cycleId": 1, "scheduleHash": "0x..", "committedTx": "0x..", "probeIds": [1, 2], "reveal": { "cycleId": 1, "committed": 2, "published": 0, "intact": false, "tx": "0x.." } }
```
500 if `API_ADMIN_TOKEN` isn't configured; 401 if the bearer token doesn't match.

Note: a single call to this endpoint only settles probes that have already
reached `included_block` by the time it runs `settle()` — for probes still
pending inclusion, call it again (or build a poller) between dispatch and
reveal. This mirrors PRD §7.3 step 4's "wait for inclusion... or timeout."

## The commit-before-dispatch guarantee

`cycle/order-guard.ts`'s `CommitBeforeDispatchGuard` is a hard runtime check,
not just call-site ordering: `cycle/dispatch.ts#submitLeg` calls
`guard.assertCanDispatch()` as its first line and throws
`CommitOrderViolation` if `commitCycle` has not landed. `cycle/run.ts` only
calls `guard.markCommitted()` after `ledger.commitCycle()` resolves. See
`test/cycle-order-guard.test.ts`, which attacks this both at the guard level
and through the real `submitLeg` code path.

## Tests

```bash
bun test
```

17 tests across 3 files:
- `test/metrics-roundtrip.test.ts` — `@gokuin/core` metric functions called
  directly, plus the same numbers read back through the live Elysia app
  (`GET /v1/routes`, `POST /v1/select`, `GET /health`) with the subgraph
  mocked at the `fetch` boundary — the bps rounding and route ranking must
  match what `packages/core` defines.
- `test/observation-signature.test.ts` — valid signature verifies and
  recovers the signer; forged signature (unlisted key) rejected; a payload
  tampered with after signing rejected; empty allowlist fails closed;
  `LISTENER_PK`-only dev fallback accepted. Also cross-checks the canonical
  message format is byte-identical to `apps/listener/src/canonical.ts`.
- `test/cycle-order-guard.test.ts` — dispatch refused before commit, allowed
  after, still refused if attempted concurrently before an in-flight async
  commit resolves, and the real `dispatch.submitLeg` refuses to sign/submit
  before the guard is committed.

`apps/listener` has its own `bun test` suite (5 tests) covering fixture-mode
auto-detection, watchlist filtering, canonical signing + recoverable
signature, and uncle-flag pass-through.

## What is live vs. simulated here

- **Real, always:** ABI-encoding of every ProbeLedger call; transaction
  signing for probe legs; the metric math (imported, not reimplemented);
  signature verification; SQLite schema and queries; GraphQL query shape
  against the Subgraph.
- **Dry-run when unconfigured, not stubbed:** ProbeLedger writes (needs
  `PROBER_PK` + `PROBE_LEDGER_ADDRESS`); route submission (needs a real relay
  URL, not the fixture default); probe funding (no funder wired in this
  task's scope).
- **Hard-unavailable when unconfigured:** all score reads
  (`/v1/routes*`, `/v1/select`) — by design, per PRD §5/§12: "no Graph, no
  scores."
