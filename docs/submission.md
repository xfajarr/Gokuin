# ETHOnline 2026 submission copy

Paste into the Hacker Dashboard. Character counts verified.

---

## One-liner

> **Best execution for transaction promises.**

Alternate, if a sentence reads better than a phrase:

> **Every route promises your transaction stays private. Gokuin is the first thing that checks.**

---

## 1. Short description (max 100 characters)

```
Every route promises privacy. Nobody checks. Gokuin probes them and publishes the evidence.
```

91 characters.

Backups, both under the limit:
- `Relays promise your transaction stays private. Gokuin checks, and publishes what actually happened.` (99)
- `A proof house for Ethereum transaction routes: we test whether they keep the promises they sell.` (96)

---

## 2. Description

```
Every route you can send an Ethereum transaction through sells a promise. Flashbots
Protect and MEV Blocker both advertise that they stop around 80% of sandwich attacks.
Both of those numbers were measured by the company that published them. Nobody else
has ever checked.

Roughly 10% of Ethereum transactions go through a private route every day. A study
that ran two nodes on two continents for nine days found 4.3% of them appeared in the
public mempool anyway. You paid for privacy, sometimes you did not get it, and nothing
told you.

Gokuin is a proof house for transaction routes. In Britain every firearm has been
test-fired by an independent body since 1637 before it can legally be sold, and the
manufacturer is forbidden from testing its own. Ethereum's routes have no equivalent.

We send twin transactions down competing routes, watch what happens to each, and write
a row that points at the evidence. Did the private route leak into the public mempool.
Did the transaction get sandwiched. How long did inclusion take. What did it cost. Each
row carries the mainnet transaction hash it indexes, so the ledger stores no opinion,
only a pointer into evidence that already exists on a public chain.

Five of the six metrics need no trust in us at all, because anyone can re-derive them
from public block data using the Substreams module we published. The sixth, whether a
private transaction leaked, rests on what our listeners saw, and it cross-checks
against third-party mempool archives that have nothing to do with us.

The probe schedule is committed on chain before anything is dispatched, so we cannot
choose favourable moments for a route or quietly drop results we dislike. Committed
count and published count are both on chain, and a gap between them is visible forever.

Routers already exist and route competently. None of them will ever publish leak
figures about the relays they partner with, and it would be irrational to expect them
to. That conflict of interest is permanent, which is why this has to be built by a
party that does not sell routing. Gokuin operates no route, sells no routing, and takes
no money from any relay.

The interface is written for someone who has never heard of a sandwich attack, because
a claim that anyone can check the numbers is not true if only an expert can read them.
Every page opens with the plain answer and puts the evidence underneath, jargon is
defined in place at first use, and each probe carries a block with the real explorer
link and the exact commands to re-derive its numbers, all copyable.

The demo sandwich is one we caused ourselves, on Sepolia, against our own probe,
because a sandwich cannot be scheduled for a recording. Rows we staged are marked and
excluded from every route's score. It is evidence the detector works, never evidence
about a route, and we do not let it become that.
```

---

## 3. How it's made

```
Contracts are Foundry and Solidity on Sepolia. ProbeLedger is append-only with no
owner, no upgrade path and no delete, because immutability is the product rather than a
feature of it. RouteRegistry is the ENSv2 subregistry for gokuin.eth: it implements the
real IRegistry and serves as its own resolver, so route scores live in ENSv2 text
records that only the Scorer contract can write. That restriction is enforced by the
contract and proved by a fuzz test over 256 arbitrary callers, not asserted in a
comment.

Detection is a Rust Substreams module published to the registry as
sandwich-detect@v0.1.0. It hardcodes no address, so anyone can point it at their own
wallet, and it is runnable by reference without cloning us: substreams run
sandwich-detect@v0.1.0 map_sandwiches -s 22450093 -t +1 returns a real historical
mainnet sandwich. A subgraph indexes the ledger on Sepolia and is the only source of
route scores, so unsetting SUBGRAPH_URL makes the scoreboard go empty rather than
stale. The Graph being load-bearing is something you can watch happen.

Scoring runs in a Chainlink CRE Confidential Workflow. The weight vector is the one
secret: public weights would let a route optimise for the ranking instead of for its
users, since knowing leak is weighted three times sandwich tells you exactly which
probes to treat well. The rows stay fully public, so anyone can score them with their
own weights. Our score is a convenience; the rows are the truth.

The backend is ElysiaJS on Bun with bun:sqlite, the frontend is TanStack Start, and an
MCP server exposes the whole thing to coding agents with a SKILL.md. Listeners run as
standalone processes in two regions because a single node only sees part of the gossip.

Three things are worth calling out as more than plumbing.

The measurement definitions live in one file that every layer imports, and the Foundry
fork test and the TypeScript test consume the same verified historical sandwich and
must agree on what it cost. If the contract and the API ever disagree about that
number, the project has no product, so the disagreement is made to fail a test instead
of reaching production.

Two constants cannot be imported across language boundaries: the contract ABI, and the
routeId map that the AssemblyScript subgraph mapping has to restate. Both are guarded
by tests, because both had already drifted once. The ABI drift was the instructive one:
the API was calling revealCycle with two arguments while the deployed contract took
four. Nothing errored at compile time. The first place it would have surfaced was a
reverted reveal during the demo, with the integrity check silently dead.

A CRE simulation failure took an afternoon and turned out not to be configuration at
all. The workflow's config schema used zod's .url() refinement, which fails
unconditionally inside the environment the CRE CLI validates config in, so it rejected
every value including obviously valid ones. Swapping it for a regex with no URL
dependency turned a hard failure into a complete simulation.

The one hacky part is deliberate and documented. A sandwich cannot be summoned on
demand, so there is a harness that stages one on Sepolia against our own probe. It
refuses to target any address that is not one of ours, it refuses to run against any
chain that is not Sepolia, and every row it produces is marked staged and excluded from
every route's score. Flashbots relays on Sepolia accept eth_sendBundle but bundles
never landed across six consecutive blocks, a known open issue, so ordering comes from
gas priority laddering with a measured success rate of roughly one in two and a retry.
Reported as measured rather than as assumed.
```
