# Gokuin — Product Requirements & Build Spec

**極印** — the mark struck into metal to certify what it actually is.
**極印を押される** — to be permanently branded.

> **Best execution for transaction promises.**
> Every route you can send a transaction through sells a promise: private, unsandwiched, fast, rebated. Nobody neutral checks. Gokuin probes each route with real transactions, records what actually happened, and stamps a mark that cannot be removed.

| | |
|---|---|
| Event | ETHOnline 2026 · From Scratch |
| Partners | The Graph · ENS · Chainlink |
| Stack | Foundry · ElysiaJS (Bun) · TanStack Start · Substreams (Rust) |
| Networks | Probes on Ethereum mainnet · contracts on Sepolia (ENSv2 beta) |
| Prize exposure | ~$16,500 |
| Deadline | 13 Sep 2026, 12:00 pm EDT |

---

## 1. Problem

| Fact | Source |
|---|---|
| ~10% of Ethereum transactions route through private mempools daily — double the 2022 share | mempool research |
| **4.3% of "private" transactions were observed in the public mempool anyway** | two nodes, two continents, nine days |
| ~5% of blocks are uncled, re-broadcasting their transactions publicly | same |
| Flashbots Protect and MEV Blocker both advertise "80% of sandwich attacks" prevented | each measuring itself |
| *"Little transparency to the reliability and performance of Relays"* — despite >85% node-operator use | Flashbots Collective |

Routers exist — RPC Fast Beam, Ironforge — optimising for landing rate. None measures leakage, because **a commercial router cannot publish leak figures about the relays it partners with.** That conflict is permanent. It is the reason this must be built by a party that does not sell routing.

### The analogy that explains it in one line

In the UK a **Proof House** has been legally required since 1637: every firearm is test-fired with a deliberately overcharged round by an independent body before it can be sold, then stamped. The manufacturer is forbidden from testing its own. Ethereum's transaction routes have no such institution.

Gokuin is that stamp.

---

## 2. Users and jobs

| User | Job to be done | Today |
|---|---|---|
| **Bot / agent operator** *(primary)* | Send this swap through a route that will not leak or sandwich it | Hardcoded RPC picked months ago; loss invisible |
| **AI agent holding funds** | Express "this one needs privacy, that one needs speed" | Agent wallets choose silently, single vendor |
| **Wallet / AA infra team** | Pick a default submission path for thousands of users | Chosen on partnership and vibes |
| **Honest relay** *(supply side)* | Prove a genuinely low leak rate | No way to; claims look identical to competitors' |
| **Anyone doing a post-mortem** | "Why was my private transaction front-run?" | No record exists to check |

**Not users:** retail swappers. They do not know what a relay is and will not learn.

---

## 3. Scope

### In — phase 1

| Promise measured | Method | Trust in Gokuin required |
|---|---|---|
| "not publicly visible before inclusion" | own listeners, 2 regions, signed observations | **yes — the only one** |
| "you will not be sandwiched" | one-block heuristic over public block data | none |
| "included quickly" | block delta submit → inclusion | none |
| value lost | receipt output vs `eth_call` at inclusion block − 1 | none |

### Out — state in README

- **Never sells routing.** One dollar from a relay ends the project.
- Not price discovery (1inch/CoW territory).
- Not a wallet, not a relay — operating a route makes us a party that needs auditing.
- Not RPC read correctness.
- No prediction. Only what already happened, pointing at hashes.

### Roadmap, not built

Bundler promises (ERC-4337 rates factories, paymasters and aggregators while explicitly leaving the bundler's own reputation out of scope), preconfirmations (fault attribution is a stated open problem), solver fill quality, rebate delivery, revert rate.

---

## 4. System architecture

```
                          ┌──────────────────────────┐
   listener-eu ──signed──▶│                          │
   listener-us ──signed──▶│   apps/api  (ElysiaJS)   │──▶ SQLite (bun:sqlite)
                          │                          │
   scheduler ────────────▶│  commit → dispatch →     │
                          │  observe → derive →      │
                          │  record → score          │
                          └────┬──────────┬──────────┘
                               │          │
                     GraphQL   │          │  viem
                               ▼          ▼
                   ┌────────────────┐  ┌──────────────────────┐
                   │ Substreams-    │  │ Sepolia contracts    │
                   │ powered        │  │  ProbeLedger         │
                   │ Subgraph       │  │  RouteRegistry (ENS) │
                   │ sandwich-detect│  │  Scorer  ◀── CRE TEE │
                   └────────────────┘  └──────────────────────┘
                               ▲                   ▲
                               │                   │
                          ┌────┴───────────────────┴────┐
                          │  apps/web (TanStack Start)  │
                          │  apps/mcp (harness)         │
                          └─────────────────────────────┘
```

### Monorepo layout

```
gokuin/
├── README.md
├── AI-DISCLOSURE.md
├── docs/
│   ├── metrics.md            measurement definitions
│   ├── credibility.md        how Gokuin can be checked + Dispute design
│   └── architecture.md
├── spec/                     planning + prompt artifacts (required if spec-driven)
├── contracts/                Foundry
│   ├── src/{ProbeLedger,RouteRegistry,Scorer}.sol
│   ├── test/
│   └── script/Deploy.s.sol
├── substreams/               Rust — sandwich-detect
├── subgraph/                 Substreams-powered subgraph
├── packages/
│   ├── core/                 shared types, metric math, zod/typebox schemas
│   └── abi/                  generated from forge build
└── apps/
    ├── api/                  ElysiaJS (Bun)
    ├── listener/             standalone Bun process, deployed ×2 regions
    ├── web/                  TanStack Start
    └── mcp/                  MCP server
```

**Why a monorepo:** `packages/core` holds the metric definitions used by the API, the MCP server and the frontend. One definition of `extractedWei`, imported everywhere — the number on screen is the number in the ledger.

### Network split — decide before writing a line

Probes run on **mainnet** (a testnet sandwich proves nothing). ENSv2 is **Sepolia-only** in beta. So contracts live on Sepolia and every row carries the **mainnet** hash it indexes.

Q&A answer: *the evidence is the mainnet hash; where we index it does not change what anyone can verify.*

---

## 5. Data model

### SQLite (operational, off-chain)

```sql
CREATE TABLE cycle (
  id            INTEGER PRIMARY KEY,
  schedule_hash TEXT NOT NULL,
  salt          TEXT,                 -- null until reveal
  probe_count   INTEGER NOT NULL,
  committed_at  INTEGER NOT NULL,     -- unix ms
  committed_tx  TEXT NOT NULL,        -- sepolia tx
  revealed_at   INTEGER,
  revealed_tx   TEXT
);

CREATE TABLE probe (
  id              INTEGER PRIMARY KEY,
  cycle_id        INTEGER NOT NULL REFERENCES cycle(id),
  route           TEXT NOT NULL,      -- 'public-mempool' | 'flashbots-protect' | 'mev-blocker'
  twin_group      TEXT NOT NULL,      -- uuid shared by the pair
  from_address    TEXT NOT NULL,      -- single-use EOA
  tx_hash         TEXT,               -- mainnet
  pool            TEXT NOT NULL,
  amount_in_wei   TEXT NOT NULL,
  slippage_bps    INTEGER NOT NULL,
  submitted_block INTEGER,
  submitted_at    INTEGER,
  included_block  INTEGER,
  status          TEXT NOT NULL       -- pending|included|dropped|reverted
);

CREATE TABLE observation (
  id          INTEGER PRIMARY KEY,
  probe_id    INTEGER NOT NULL REFERENCES probe(id),
  region      TEXT NOT NULL,          -- 'eu-central' | 'us-east'
  tx_hash     TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,       -- unix ms
  seen_block  INTEGER NOT NULL,       -- head at observation
  from_uncle  INTEGER NOT NULL DEFAULT 0,
  signature   TEXT NOT NULL,          -- listener key over (txHash, firstSeen, region)
  signer      TEXT NOT NULL
);

CREATE TABLE derivation (
  probe_id      INTEGER PRIMARY KEY REFERENCES probe(id),
  sim_out       TEXT NOT NULL,
  real_out      TEXT NOT NULL,
  extracted_wei TEXT NOT NULL,
  sandwiched    INTEGER NOT NULL,
  frontrun_hash TEXT,
  backrun_hash  TEXT,
  leaked        INTEGER NOT NULL,
  leaked_at     INTEGER,
  module_version TEXT NOT NULL,
  ledger_tx     TEXT                  -- sepolia record() tx
);

CREATE INDEX idx_probe_cycle ON probe(cycle_id);
CREATE INDEX idx_obs_probe   ON observation(probe_id);
```

`bun:sqlite` is deliberate: zero infra, one file, survives the weekend. Swap to Postgres when two writers exist.

### Subgraph entities (The Graph)

```graphql
type Sandwich @entity {
  id: ID!                 # victimTxHash
  block: BigInt!
  pool: Bytes!
  victim: Bytes!
  frontrunTx: Bytes!
  backrunTx: Bytes!
  attacker: Bytes!
  extractedWei: BigInt!
  detectedBy: String!     # module version
}

type Route @entity {
  id: ID!                 # route label
  probes: BigInt!
  leaks: BigInt!
  sandwiches: BigInt!
  totalExtractedWei: BigInt!
  medianDelayBlocks: Int!
  rows: [Row!]! @derivedFrom(field: "route")
}

type Row @entity {
  id: ID!                 # sepolia log id
  route: Route!
  mainnetTxHash: Bytes!
  includedBlock: BigInt!
  leaked: Boolean!
  sandwiched: Boolean!
  extractedWei: BigInt!
  cycleId: Int!
}
```

**Graph is load-bearing:** the API and the MCP server read scores from this subgraph, never from SQLite. No Graph, no scores.

---

## 6. Smart contracts — Foundry

Network: **Sepolia**. Solidity `^0.8.26`.

### 6.1 `ProbeLedger.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Append-only index into public evidence. Stores no opinion.
contract ProbeLedger {
    struct Row {
        bytes32 mainnetTxHash;   // the evidence; everything else is derived from it
        uint64  submittedBlock;
        uint64  includedBlock;
        uint64  leakedAtBlock;   // 0 = not leaked
        uint128 extractedWei;
        uint128 simOut;
        uint128 realOut;
        uint32  routeId;
        uint16  cycleId;
        bool    sandwiched;
    }

    struct Cycle {
        bytes32 scheduleHash;
        bytes32 salt;            // 0 until revealed
        uint16  committedCount;
        uint16  publishedCount;
        uint64  committedAt;
        bool    revealed;
    }

    address public immutable prober;
    mapping(uint16 => Cycle)  public cycles;
    Row[] public rows;
    mapping(uint32 => uint256[]) internal _rowsByRoute;

    event CycleCommitted(uint16 indexed cycleId, bytes32 scheduleHash, uint16 count);
    event CycleRevealed (uint16 indexed cycleId, bytes32 salt, uint16 published, bool intact);
    event RowRecorded   (uint16 indexed cycleId, uint32 indexed routeId, uint256 rowId, bytes32 mainnetTxHash);

    error NotProber();
    error CycleExists();
    error CycleUnknown();
    error AlreadyRevealed();
    error BadSalt();

    modifier onlyProber() { if (msg.sender != prober) revert NotProber(); _; }

    constructor(address prober_) { prober = prober_; }

    /// @notice Post the schedule hash BEFORE any probe is dispatched.
    function commitCycle(uint16 cycleId, bytes32 scheduleHash, uint16 count) external onlyProber;

    /// @notice Append one probe result. Never updated, never deleted.
    function record(uint16 cycleId, Row calldata row) external onlyProber returns (uint256 rowId);

    /// @notice Reveal the salt. Anyone can now recompute the schedule and compare counts.
    function revealCycle(uint16 cycleId, bytes32 salt) external onlyProber;

    /// @notice committed vs published — a gap is visible to everyone, forever.
    function integrity(uint16 cycleId) external view returns (uint16 committed, uint16 published, bool intact);

    function rowsByRoute(uint32 routeId) external view returns (uint256[] memory);
    function rowCount() external view returns (uint256);
}
```

**Design constraints**
- No `update`, no `delete`, no owner, no upgrade proxy. Immutability is the product.
- `prober` is immutable — set at deploy, cannot rotate. If the key is lost, deploy a new ledger and say so.
- Storage is packed: `Row` fits three slots.
- `scheduleHash = keccak256(abi.encode(cycleId, routeIds, slots, salt))`.

### 6.2 `RouteRegistry.sol` — ENSv2

```solidity
/// @notice One ENSv2 subname per route: <label>.gokuin.eth
///         Score text records are writable ONLY by the Scorer.
contract RouteRegistry {
    address public immutable scorer;
    address public immutable ensRegistry;

    mapping(uint32 => bytes32) public nodeOf;     // routeId → ENS node
    mapping(bytes32 => uint32) public routeOfNode;

    event RouteRegistered(uint32 indexed routeId, string label, bytes32 node);
    event ScoreWritten(uint32 indexed routeId, string key, string value);

    error NotScorer();

    /// @notice Create <label>.gokuin.eth and point it at the permissioned resolver.
    function registerRoute(uint32 routeId, string calldata label) external;

    /// @notice Write a score text record. Reverts for any caller but the Scorer —
    ///         this is the "only we can write" claim, enforced instead of promised.
    function setScore(uint32 routeId, string calldata key, string calldata value) external;
}
```

Text record keys written: `gokuin.leakBps`, `gokuin.sandwichBps`, `gokuin.medianDelay`, `gokuin.probes`, `gokuin.lastCycle`, `gokuin.evidenceURI`.

### 6.3 `Scorer.sol`

```solidity
/// @notice Receives the weighted score from the CRE Confidential Workflow.
///         Weights never appear on-chain — only their output does.
contract Scorer {
    address public immutable creForwarder;
    RouteRegistry public immutable registry;

    event Scored(uint32 indexed routeId, uint16 leakBps, uint16 sandwichBps, uint16 medianDelay, uint16 composite);

    error NotCRE();

    function submitScore(
        uint32 routeId,
        uint16 leakBps,
        uint16 sandwichBps,
        uint16 medianDelay,
        uint16 composite,
        string calldata evidenceURI
    ) external; // onlyCRE → writes through registry.setScore
}
```

### 6.4 Not built — documented in `docs/credibility.md`

```solidity
contract Dispute {
    // bond() → challenge a rowId with an alternative derivation from the same hash
    // if the challenger is right: row flagged, Gokuin's bond slashed
    // Gokuin is a rated entity in its own ledger
}
```

Say plainly in the video: designed, not shipped.

### 6.5 Foundry test plan

| Test | Asserts |
|---|---|
| `test_RecordAppendsOnly` | no path mutates an existing row |
| `test_OnlyProberCanRecord` | any other sender reverts `NotProber` |
| `test_IntegrityDetectsGap` | commit 10, publish 8 → `intact == false` |
| `test_RevealValidatesSalt` | wrong salt reverts `BadSalt` |
| `test_OnlyScorerWritesENS` | non-scorer `setScore` reverts — **this is the ENS track's proof** |
| `testFork_DeriveKnownSandwich` | mainnet fork at a known sandwich block; `simOut − realOut` equals the value computed off-chain |
| `test_RowPacking` | gas snapshot; `Row` stays within three slots |

`testFork_DeriveKnownSandwich` is the important one: it pins the measurement definition into the test suite so it cannot drift between the contract, the API and the UI.

---

## 7. Backend — ElysiaJS (Bun)

### 7.1 Module map

```
apps/api/src/
├── index.ts              Elysia app, plugin composition, .listen()
├── db.ts                 bun:sqlite, migrations, prepared statements
├── env.ts                typed env with TypeBox
├── chain/
│   ├── clients.ts        viem: mainnet public, sepolia wallet, per-route transports
│   ├── routes.ts         route registry: name → transport + capabilities
│   └── ledger.ts         ProbeLedger writes via viem
├── cycle/
│   ├── schedule.ts       build schedule, hash it, commit
│   ├── dispatch.ts       rotate EOA, build twin swaps, submit
│   └── reveal.ts         publish salt, assert counts match
├── observe/
│   └── ingest.ts         verify listener signature, store observation
├── derive/
│   ├── simulate.ts       eth_call identical calldata at includedBlock-1
│   ├── sandwich.ts       read Subgraph, join to probe
│   └── settle.ts         compose Row, write to ledger
├── score/
│   └── read.ts           GraphQL against the Subgraph (never SQLite)
└── routes/
    ├── public.ts         GET endpoints for web + mcp
    ├── listener.ts       POST /observations  (signed)
    └── admin.ts          POST /cycles/run    (bearer)
```

### 7.2 API surface

```ts
// apps/api/src/routes/public.ts
new Elysia({ prefix: '/v1' })
  .get('/routes', () => scoreRead.allRoutes(), {
    response: t.Array(RouteScore)
  })
  .get('/routes/:id', ({ params }) => scoreRead.route(params.id), {
    params: t.Object({ id: t.String() })
  })
  .get('/routes/:id/rows', ({ params, query }) => scoreRead.rows(params.id, query), {
    query: t.Object({ limit: t.Numeric({ default: 50 }), cursor: t.Optional(t.String()) })
  })
  .get('/probes/:id', ({ params }) => probes.detail(params.id))      // twin + block + derivation
  .get('/cycles/:id/integrity', ({ params }) => cycles.integrity(params.id))
  .post('/select', ({ body }) => selector.pick(body), {              // the routing decision
    body: t.Object({
      need: t.Union([t.Literal('privacy'), t.Literal('speed'), t.Literal('inclusion'), t.Literal('cheap')]),
      maxLeakBps: t.Optional(t.Number()),
      maxWaitBlocks: t.Optional(t.Number())
    }),
    response: t.Object({
      route: t.String(),
      reason: t.String(),
      evidence: t.Array(t.Object({ txHash: t.String(), what: t.String() })),
      runnerUp: t.String()
    })
  })
```

```ts
// apps/api/src/routes/listener.ts — the only write path from outside
.post('/observations', async ({ body, set }) => {
  const ok = await verifyObservation(body)   // recover signer, check allowlist
  if (!ok) { set.status = 401; return { error: 'unrecognised listener' } }
  return observe.ingest(body)
}, {
  body: t.Object({
    txHash: t.String(), region: t.String(),
    firstSeen: t.Number(), seenBlock: t.Number(),
    fromUncle: t.Boolean(), signature: t.String()
  })
})
```

**`/v1/select` is the product.** It returns `reason` and `evidence` alongside `route` — an agent must be able to explain its choice to its user, with hashes.

### 7.3 Cycle orchestration

```
POST /admin/cycles/run
  1. schedule.build()      routes × slots, salt
  2. ledger.commitCycle()  Sepolia tx — BEFORE dispatch
  3. dispatch.twins()      rotate EOA, build identical swaps, submit to each route
  4. wait for inclusion    or timeout → status 'dropped'
  5. observe               listeners have been POSTing all along
  6. derive.simulate()     eth_call at includedBlock-1
  7. derive.sandwich()     GraphQL to Subgraph
  8. settle()              compose Row, ledger.record() per probe
  9. reveal.publish()      salt on-chain; assert published == committed
```

Runs as a Bun cron (`Bun.cron` or a simple `setInterval` supervisor). Step 2 before step 3 is a hard ordering constraint — the commit is worthless if it lands after dispatch.

### 7.4 Listener — `apps/listener`

Standalone Bun process, deployed to two regions. Not part of the API.

```ts
const client = createPublicClient({ transport: webSocket(env.WS_URL) })
client.watchPendingTransactions({
  onTransactions: async (hashes) => {
    const seenBlock = await client.getBlockNumber()
    for (const txHash of hashes) {
      const payload = { txHash, region: env.REGION, firstSeen: Date.now(), seenBlock, fromUncle: false }
      const signature = await signer.signMessage({ message: canonical(payload) })
      void post(`${env.API}/v1/observations`, { ...payload, signature })
    }
  }
})
```

Only hashes in the current cycle's watchlist are forwarded — the API hands each listener the watchlist at cycle start. Uncle re-broadcasts are flagged, stored, and excluded from the leak flag.

### 7.5 Eden Treaty

Export the Elysia app type; the frontend and MCP server import it for end-to-end types with no codegen step.

```ts
export type App = typeof app          // apps/api/src/index.ts
const api = treaty<App>(env.API_URL)  // apps/web, apps/mcp
```

---

## 8. Substreams — `sandwich-detect`

Rust module streaming every mainnet block.

```rust
// map_sandwiches(block: eth::Block) -> Sandwiches
// heuristic:
//   front-run A at index i, victim V at index j>i, back-run B at index k>j
//   same block, same pool, A and B opposite directions,
//   distinct hashes, A.from == B.from
```

Output feeds a **Substreams-powered subgraph** deployed to Subgraph Studio.

**Deliberately generic:** takes any address, not just Gokuin probes. This is what satisfies The Graph's *"tooling must be reusable infrastructure, not a one-off app"* — anyone can point it at their own wallet and ask whether they have been sandwiched.

Validation gate before trusting it live: run against a **known historical sandwich** and a **known clean block**, both pinned in the repo as fixtures.

---

## 9. Frontend — TanStack Start

### 9.1 Route tree

```
apps/web/src/routes/
├── __root.tsx              shell, theme, nav
├── index.tsx               scoreboard — the money page
├── route.$id.tsx           one route's record + evidence table
├── probe.$id.tsx           single probe: twin comparison, block view, derivation
├── cycle.$id.tsx           commit / reveal / integrity
├── method.tsx              measurement definitions + how Gokuin can be checked
└── console.tsx             live probe runner (demo surface)
```

### 9.2 Page specs

**`/` — Scoreboard**
- Table: route · probes · leaks · sandwich % · median inclusion · ETH lost
- Each cell links to the rows that produced it. No number without a path to its hashes.
- Header states the cycle integrity: *"committed 100 · published 100 · intact"*
- Loader: `createServerFn` → `api.v1.routes.get()`

**`/probe/$id` — the demo page**
- Twin side-by-side, identical params visibly identical
- Block view: three transactions in order, victim striped
- Derivation table with a `public` / `attested` column per metric — **five of six say `public`**
- Ledger row as emitted, with the Sepolia tx link

**`/method`**
- Metric definitions from `packages/core` — rendered from the same constants the API uses
- The six credibility mechanisms
- Explicit: what is live, what is simulated, what is designed but unbuilt

**`/console`**
- Runs a cycle against the API, streams stage progress
- This is what gets screen-recorded

### 9.3 Data loading

```ts
// apps/web/src/routes/index.tsx
const getScoreboard = createServerFn({ method: 'GET' }).handler(async () => {
  const { data } = await api.v1.routes.get()
  return data
})

export const Route = createFileRoute('/')({
  loader: () => getScoreboard(),
  component: Scoreboard,
})
```

Server functions keep the API key server-side and give the page a filled first paint — the scoreboard must be readable before any JS runs, because it is the first frame of the demo.

### 9.4 Design

Reuse the console prototype's tokens: warm charcoal ground, IBM Plex Mono for data, IBM Plex Sans for prose, single amber accent, brick and moss reserved for semantics only. `tabular-nums` on every numeric column.

---

## 10. MCP server — `apps/mcp`

```ts
server.tool('gokuin_submit', {
  description: 'Send a transaction through the route whose measured record best matches the guarantee you need.',
  inputSchema: {
    tx: z.string(),
    need: z.enum(['privacy','speed','inclusion','cheap']),
    maxLeakBps: z.number().optional(),
    maxWaitBlocks: z.number().optional()
  }
}, async (args) => {
  const pick = await api.v1.select.post(args)
  const hash = await routes.submit(pick.route, args.tx)
  return { hash, route: pick.route, reason: pick.reason, evidence: pick.evidence }
})

server.tool('gokuin_routes',  ...)   // list with scores
server.tool('gokuin_explain', ...)   // one route's record + evidence hashes
```

Ships with `apps/mcp/SKILL.md` — required by The Graph's AI track.

**The return value always carries `reason` and `evidence`.** An agent that cannot say why it chose a route is no better than a hardcoded URL.

---

## 11. Measurement definitions

Lives in `packages/core/metrics.ts`, imported by API, MCP and web. One definition, three consumers.

| Metric | Definition |
|---|---|
| **leaked** | Treatment tx hash observed in the public mempool by ≥2 independent signed listeners at a block height strictly below its inclusion block. Uncle re-broadcasts excluded and logged separately. |
| **sandwiched** | A exists before ours and B after, same block, same pool, opposite directions, distinct hashes, `A.from == B.from`. |
| **extractedWei** | `simOut − realOut`, where `simOut` is an `eth_call` of identical calldata against state at `includedBlock − 1`. |
| **delayBlocks** | `includedBlock − submittedBlock`, `submittedBlock` = head at dispatch. |

---

## 12. Credibility

- **Five of six metrics need no trust in Gokuin.** Sandwich, extracted value, delay, revert and rebate all derive from public block data via an open-source module.
- **The leak flag is the one observation** — mitigated four ways: multiple signed listeners; TEE-attested observation; third-party mempool archives (Blocknative sells historical Ethereum mempool data, marketed explicitly for analysing private transactions) as independent cross-check; anyone may run a listener.
- **Commit-reveal kills cherry-picking and omission together.** A gap between committed and published is on-chain forever.
- **Rows public, weights private.** The score is a convenience; the rows are the truth. This is also the answer to the ERC-8004 thread's *"trust is not a universal value of Bob, but a vector from Alice to Bob."*
- **Gokuin sits in its own ledger**, disputed and overturned rows public.
- **Gokuin never sells routing.**

### 30-second Q&A answer — memorise

> "We don't ask to be trusted. Five of six metrics anyone can re-derive from public data. The sixth — leakage — cross-checks against a third-party mempool archive that has nothing to do with us. The schedule is committed before it runs, so we can't pick our moments and can't hide results. Weights are private, rows are public: don't like our weights, score it yourself. And we're in the same ledger — bond against us, and if you're right, we get slashed."

---

## 13. Sponsor mapping

### The Graph — 1 slot, 2 tracks, $10,000

| Requirement | Answer |
|---|---|
| Compose 2+ Graph products or a standardized schema | Substreams module feeding a Substreams-powered Subgraph — two products, composed |
| Live provider data; mocks disqualify | Subgraph Studio, queried live in the demo |
| Reusable infrastructure, not a one-off app | `sandwich-detect` takes any address, not just our probes |
| Graph load-bearing for the AI track | API and MCP read scores only from the Subgraph. No Graph, no scores |
| Open source + README or SKILL.md | `apps/mcp/SKILL.md` |

Their Lisbon thesis — *"freshness as a correctness property, not a nice-to-have"* — is this project's entire subject. Quote it back in the writeup.

### ENS — 1 slot, $4,500

| Requirement | Answer |
|---|---|
| ENSv2 on Sepolia, central not cosmetic | The subname registry **is** the route identity layer; scores are text records |
| Functional, no hard-coded values | Scores written by `Scorer`, resolved live in `/v1/select` |
| Enhanced access control / permissioned resolver | Only `Scorer` may write. `test_OnlyScorerWritesENS` proves it, on camera |

Pattern that has won three times: ENShell, npmguard, Immunity.

### Chainlink — 1 slot, $2,000

| Requirement | Answer |
|---|---|
| CRE Confidential Workflows for a meaningful part | Scoring weights in the enclave. Public weights let routes optimise for the ranking instead of for users — mechanism, not decoration |
| Register `handlerInTee` / `cre.HandlerInTee` | Scoring handler |
| One sensitive input inside the enclave | Weight vector + listener signing keys |
| Evidence: CLI simulation or live deployment | Simulation logs in repo and on camera |
| **No Functions, no Automation** (deprecating) | Not used anywhere |

**Bonus:** none of these three requires a feedback document. Uniswap needs `FEEDBACK.md` + form, World needs a feedback doc, Ledger judges DX feedback as much as code. Three failure modes avoided for free.

---

## 14. Build plan

Ordered by **risk**, not dependency. The thing that can kill the project goes first.

### P0 · Repo
`bun create`, workspace, Foundry init, directory tree, `README.md`, `AI-DISCLOSURE.md`.
**Done when:** repo public, ≥3 real commits. Commit continuously from here — a single last-day dump is assumed unqualified.

### P1 · Listener *(riskiest — do it first)*
`apps/listener` watching pending transactions in one region, signing observations, POSTing to a stub endpoint.
**Done when:** hand it any hash, get back a first-seen timestamp. Then duplicate to region two.
**If this fails, pivot here** — before anything is sunk into contracts.

### P2 · Twin dispatch
`apps/api` cycle module: rotate EOA, build one swap, submit to two routes in the same block window. Bait: thin pool, 8% slippage, small size.
**Done when:** two identical swaps land on mainnet from two never-before-seen addresses.

### P3 · Substreams
`sandwich-detect` + subgraph deploy.
**Done when:** flags a known historical sandwich correctly and leaves a known clean block alone. Fixtures committed.

### P4 · Deriver
`eth_call` at `includedBlock − 1`, compare to receipt, compute `extractedWei`. Mirror it in `testFork_DeriveKnownSandwich`.
**Done when:** contract test and API produce the same number for the same block.

### P5 · Contracts
Foundry: `ProbeLedger`, `RouteRegistry`, `Scorer`. Deploy Sepolia. Wire commit → record → reveal.
**Done when:** a row is on-chain, its score resolves through an ENS name, and a non-scorer write reverts.

### P6 · Web
TanStack Start: `/`, `/probe/$id`, `/method`. Loaders through Eden Treaty.
**Done when:** the scoreboard renders real rows with links to real hashes, server-rendered.

### P7 · MCP
`gokuin_submit` returning route + reason + evidence.
**Done when:** Claude Code calls it and a real transaction goes out on a route it chose.

### P8 · CRE *(droppable)*
Move weights into the enclave. Capture CLI simulation logs.
**Done when:** weights appear in no public artifact and the log is in the repo.

### P9 · Ship
`/console` polish, video, partner writeups, submit.

### Cut order

1. **Cut 1st** — P8 CRE. Lose $2,000, keep the project. Weights stay in the API, move to the enclave later.
2. **Cut 2nd** — third route. Two routes still demonstrate the mechanism.
3. **Cut 3rd** — `/cycle/$id` and `gokuin_explain`. `/` and `gokuin_submit` carry the story.
4. **Never cut** — listener, twin dispatch, sandwich detection, on-chain row, video.

---

## 15. Testing

| Layer | What | Tool |
|---|---|---|
| Contracts | unit + fork; the fork test pins the metric definition | `forge test --fork-url $MAINNET_RPC` |
| Metrics | `extractedWei` against fixtures shared with the fork test | `bun test` |
| Listener | replay a recorded mempool stream, assert first-seen ordering | `bun test` |
| API | route contract tests through Eden Treaty | `bun test` |
| Substreams | known-sandwich and known-clean fixtures | `substreams run` |

One rule: **the fork test and the TypeScript metric test consume the same fixture and must agree.** If the contract and the API disagree about what a sandwich cost, the project has no product.

---

## 16. Demo video — 4 minutes

| Time | Shot | Say |
|---|---|---|
| 0:00–0:15 | Two claims side by side: both relays advertising 80% sandwich prevention | *"Both measured that themselves. Nobody else has ever checked."* |
| 0:15–0:30 | Gokuin: the mark struck into metal to certify what it actually is | *"In Britain, every firearm is test-fired by an independent proof house before it can be sold. The maker isn't allowed to test its own. Ethereum's transaction routes have no such thing."* |
| 0:30–0:50 | Commit hash on Sepolia. Twin transactions built, dispatched | *"Same swap, twice. One naked into the public mempool, one through the protected route."* |
| 0:50–1:40 | **The shot.** Explorer: three transactions in one block — front-run, ours, back-run. Then `simOut` vs `realOut` | *"That's what it cost. Not a simulation — that money is gone."* |
| 1:40–2:05 | Twin comes back clean. Both write to the ledger, including the boring one | *"The null result gets recorded too. Publishing only the dramatic cycles would mean writing our own story."* |
| 2:05–2:45 | Subgraph query live; ENS name resolving to scores; `forge test` showing a non-scorer write revert | *"Only the scorer can write. That's enforced by the contract, not promised by us."* |
| 2:45–3:20 | Claude Code calls `gokuin_submit(need: "privacy")` — route, reason, evidence | *"The agent never picks a route again. And it can tell you why it chose this one."* |
| 3:20–4:00 | Why no incumbent can do this. Roadmap: bundlers, preconfirmers. Stop | *"Routers already exist. None can publish leak rates about their own partners. That's why this has to be neutral."* |

**The shoot risk:** a sandwich cannot be summoned. Three insurances — aggressive bait; several successful pairs recorded in advance; and if the live one comes back clean, say so and record it. A ledger that stays honest when nothing happens is more convincing than one that always finds a villain.

---

## 17. Submission checklist

Items marked **[!]** are disqualifiers.

- [ ] **[!]** Submitted before **13 Sep, 12:00 pm EDT**. Late is not accepted.
- [ ] **[!]** Video **2:00–4:00**, ≥720p, human voice. No phone, no AI voiceover, no music over text, not sped up.
- [ ] **[!]** Public repo, **real commit history**. Single last-day dump assumed unqualified.
- [ ] **[!]** `AI-DISCLOSURE.md` + spec/prompt artifacts in `spec/`.
- [ ] **[!]** Exactly three partners: The Graph, ENS, Chainlink.
- [ ] **[!]** Graph data live from a Graph provider. Any mock in the required path fails.
- [ ] **[!]** ENSv2 on Sepolia, central, no hard-coded names.
- [ ] **[!]** Chainlink CRE only — Functions and Automation are deprecating.
- [ ] Per-partner writeup answering each qualification bullet in §13, in order.
- [ ] README points at contract addresses and specific line numbers.
- [ ] README states what is live, what is simulated, what is designed but unbuilt.
- [ ] Opted into **Finalist and Partner Prizes**.
- [ ] Video upload dry-run before deadline day.
- [ ] Payout address double-checked.

---

## 18. Risks

| Risk | Mitigation |
|---|---|
| Listener can't reliably see the public mempool | Built first, P1. Fail there and pivot before anything is sunk |
| No sandwich during the shoot | Aggressive bait, pre-recorded pairs, honesty if the live one is clean |
| "Beam already routes transactions" | Never pitch routing. Pitch measurement. Their conflict of interest is permanent and it is the answer |
| "Relay dashboards already exist" | True — beaconcha.in, MEV Watch, Metrika. All measure the *operator's* side: bids, latency, missed slots. None measures the *sender's* outcome, none tests whether private was private |
| "Who declares ground truth?" | Nobody. Five of six metrics derive from public block data; the sixth cross-checks a third-party archive |
| Probes fingerprinted | Rotated single-use EOAs funded through a distributor. Have this answer ready before it's asked |
| Probes cost real money | Small sizes, budgeted. The loss **is** the evidence |
| Accusing named companies | Every claim points at a public transaction hash. Zero assertions that cannot be re-derived |
| Contract and API disagree on a metric | The fork test and the TS test share one fixture and must agree |

---

## 19. After the hackathon

Phase 2 is the rest of the promise surface, ordered by market size rather than novelty: **bundlers** first — ERC-4337 rates account factories, paymasters and aggregators while explicitly leaving the bundler's own reputation design out of scope, and the market already has six named providers with published share. Then **solver fill quality**, then **preconfirmations**, where fault attribution is a stated open problem and reputation is the intended punishment mechanism.

The attestation target stays ERC-8004's Validation Registry — a standard authored by MetaMask, the Ethereum Foundation, Google and Coinbase, whose own forum thread has no answer for who produces the attestations, and whose live data is 52% empty shells across 34,556 registrations. Being its first honest data producer beats owning a registry nobody adopts.
