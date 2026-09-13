---
name: gokuin
description: >-
  Independent, adversarially-measured scores for Ethereum transaction submission
  routes (public mempool, Flashbots Protect, MEV Blocker, and others as they are
  added) (leak rate, sandwich rate, inclusion delay, value extracted) plus a
  route picker that returns a route, a plain-language reason, and real mainnet
  transaction hashes as evidence. Use this before choosing where to send a
  transaction whose outcome matters: anything holding user funds, anything that
  should not be front-run, anything where "it landed eventually" is not good enough.
---

# Gokuin: proof house for transaction routes

## What this is

Every route a transaction can go through (public mempool, a "private" relay, a
protected RPC) sells a promise: not front-run, not visible before inclusion,
fast, cheap. Nobody neutral checks those promises, the routes measure
themselves, and a router that also sells routing cannot publish bad numbers
about its own suppliers.

Gokuin is the neutral check. It never operates a route and never takes money
from one. Instead it dispatches real, paired probe transactions through every
route on **Ethereum mainnet**, watches what actually happens with independent
signed listeners in two regions, and derives four numbers per route from that:

| Metric | What it means | Where it comes from |
|---|---|---|
| `leakBps` | How often the "private" route's transaction was seen in the public mempool before it was included, in basis points | the one **attested** metric: cross-checked by ≥2 independent signed listeners |
| `sandwichBps` | How often the transaction was sandwiched (front-run then back-run, same block, same pool) | **public**: re-derivable by anyone from block data |
| `medianDelayBlocks` | Median blocks between submission and inclusion | **public** |
| `totalExtractedWei` | Total value extracted from probes on this route (`simOut − realOut` at inclusion), summed | **public** |

**This is load-bearing on live Graph data, not a local cache.** Every score
this server returns is read, at call time, from the Gokuin API's
`GET /v1/routes` / `GET /v1/routes/:id`, which itself reads exclusively from a
**Substreams-powered subgraph** (`sandwich-detect` Substreams module feeding a
subgraph deployed on Subgraph Studio). There is no SQLite fallback and no
cached snapshot in this path, if the subgraph is behind or unreachable, the
API call fails and this server tells you so instead of inventing a number.

## When an agent should reach for this

Reach for `gokuin_submit` instead of a hardcoded RPC URL whenever:

- You are about to broadcast a **signed** Ethereum mainnet transaction on
  behalf of a user or another agent, and where it lands changes the outcome
  (MEV exposure, front-running, time sensitivity, cost).
- You need to be able to answer "why did you send it there?" with something
  more specific than "that's the URL I always use."
- The transaction is large enough, or sensitive enough, that a wrong routing
  choice would cost real money.

Do **not** reach for this to *build* a transaction, get a quote, or do price
discovery, Gokuin only measures how a transaction is delivered after it is
already signed. It is not a wallet, not a relay, and not a swap router.

## The non-negotiable contract

**Every tool below always returns `reason` and `evidence` alongside its
answer.** `evidence` is an array of `{ txHash, what }`, real mainnet
transaction hashes with a one-line note on what each one proves. An agent (or
the human behind it) should always be able to point at a specific hash and
say "that's why." If Gokuin's API is unreachable, every tool below fails
loudly with a clear error instead of guessing, a wrong route costs real
money, so a silent fallback is strictly worse than a refusal.

## Tools

### `gokuin_submit`

Picks the best-measured route for a stated need, submits the transaction
through that route's own transport, and returns what happened.

**Input**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `tx` | string | yes | Raw, already-signed transaction hex (`0x...`). Gokuin never signs anything. |
| `need` | `"privacy" \| "speed" \| "inclusion" \| "cheap"` | yes | What guarantee matters most: don't leak pre-inclusion / land fastest / lowest drop-and-retry rate / cheapest to land. |
| `maxLeakBps` | number | no | Refuse any route whose measured leak rate exceeds this (basis points). |
| `maxWaitBlocks` | number | no | Refuse any route whose measured median inclusion delay exceeds this many blocks. |

**Output**

```json
{
  "hash": "0x...",
  "route": "flashbots-protect",
  "reason": "flashbots-protect: 412 probes, 3 leaked (73bps, attested)...",
  "evidence": [
    { "txHash": "0x1234...", "what": "probe that leaked into the public mempool 2 blocks before inclusion, observed by 2 listeners" }
  ]
}
```

If route selection or submission fails (API unreachable, route transport
rejects the transaction, unknown route id), the tool returns an MCP tool error
(`isError: true`) whose text explains exactly what went wrong and confirms
whether or not anything was actually broadcast. It never falls back to
picking a route on its own guess.

**Worked example**

> Agent holds a swap it needs to execute without being front-run.
>
> Call: `gokuin_submit({ tx: "0x02f8b1...", need: "privacy", maxLeakBps: 500 })`
>
> Response: `{ hash: "0xabc...", route: "mev-blocker", reason: "mev-blocker: 890 probes, 12 leaked (135bps, attested)... chosen because it has the lowest measured leak rate under 500bps among routes with ≥100 probes", evidence: [...] }`
>
> The agent now has a hash to report to whoever it's acting for, and a reason
> that names actual measured numbers, not a vendor's marketing page.

### `gokuin_routes`

Lists every route Gokuin has probed with its current measured score. No
input.

**Output**

```json
{
  "routes": [
    { "route": "public-mempool", "probes": 900, "leaks": 900, "leakBps": 10000, "sandwiches": 41, "sandwichBps": 456, "medianDelayBlocks": 1, "totalExtractedWei": "812340000000000000", "lastCycle": 214 },
    { "route": "flashbots-protect", "probes": 900, "leaks": 3, "leakBps": 33, "sandwiches": 0, "sandwichBps": 0, "medianDelayBlocks": 2, "totalExtractedWei": "0", "lastCycle": 214 }
  ],
  "reason": "2 route(s) measured. Scores read live from GET /v1/routes (Substreams-powered subgraph behind it, never a local cache)...",
  "evidence": []
}
```

Use this to survey the field before deciding what to ask `gokuin_explain`
about, or to build your own selection logic instead of trusting
`gokuin_submit`'s pick. `evidence` is deliberately empty here, an aggregate
list carries no row-level hashes by itself; call `gokuin_explain` for those.

### `gokuin_explain`

One route's full measured record plus the evidence hashes behind it.

**Input**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `route` | string | yes | Route id, e.g. `"flashbots-protect"`. See `gokuin_routes` for the current list. |

**Output**

```json
{
  "route": "flashbots-protect",
  "record": { "route": "flashbots-protect", "probes": 900, "leaks": 3, "leakBps": 33, "sandwiches": 0, "sandwichBps": 0, "medianDelayBlocks": 2, "totalExtractedWei": "0", "lastCycle": 214 },
  "reason": "flashbots-protect: 900 probes so far, 3 leaked (33 bps, the one attested metric...)...",
  "evidence": [
    { "txHash": "0x9f1c...", "what": "probe routed through flashbots-protect that Gokuin picked for a recent 'privacy' request" }
  ]
}
```

Evidence is drawn first from the route's own recent ledger rows
(`GET /v1/routes/:id/rows`, each row a real mainnet tx with its own
leaked/sandwiched/clean outcome), falling back to recent route-selection
evidence if no rows are available yet. If neither source has anything,
`evidence` comes back empty, the record itself is still live from the
subgraph; Gokuin never fabricates a hash to fill the array.

## What this server will never do

- Never picks a route when its API is unreachable: it errors instead.
- Never returns a score without saying where it came from.
- Never claims a hash as evidence unless it is a real, submitted mainnet
  transaction hash.
- Never operates a route itself, and never takes payment from one: that
  conflict of interest is exactly what Gokuin exists to check for in everyone
  else.
