# Implementation briefs

The build was split across parallel agents working in disjoint directories, each
given a written brief. Recorded here because ETHOnline asks for the prompts when a
spec-driven workflow is used, and because the constraints in them are the reason
several components hold properties the code alone would not explain.

Every brief was given `PRD.md` as the authoritative spec and
`packages/core/src/metrics.ts` as the authoritative measurement definitions.

## Contracts

Build `ProbeLedger`, `RouteRegistry`, `Scorer` and their tests. Constraints that
mattered:

- Append-only with no owner, no upgrade, no delete. Immutability is the product.
- `test_OnlyScorerWritesENS` must prove the permissioned write on-chain rather
  than assert it in a comment. Later strengthened into a 256-run fuzz over
  arbitrary callers, after a follow-up brief asked for "exactly one authorised
  writer" rather than "this one stranger fails".
- When the Scorer signature gap surfaced, the follow-up was explicit: widen
  `submitScore`, do **not** give the API a second write path, because the second
  writer would break the exact property the ENS demo asserts.

## API and listener

- The commit must land on-chain before any probe dispatches, enforced in code
  rather than by convention.
- Scores read from the subgraph and never fall back to SQLite, so "Graph is
  load-bearing" is demonstrable.
- The listener is a standalone process, not a route, because it runs in two
  regions.
- Where a live key is absent, do the real encode and sign and skip only the
  network call. Never stub the logic, because a stub exercises different code
  than production does.

## Substreams

- The module must hardcode no address. Anyone can point it at their own wallet.
  This is what makes the Graph "reusable infrastructure" claim survive an audit.
- Find a **real** historical sandwich for the fixture and verify it independently
  on chain rather than trusting the paper that reported it.

## Frontend

- The derivation table must be driven off `PROVENANCE` from `@gokuin/core` so the
  five-public / one-attested split cannot drift from what the API computes.
- `/method` renders definitions by calling the real functions, so the page cannot
  describe a metric the code does not implement.
- `/console` never falls back to sample data. Read-only pages may, behind a
  visible banner; a page claiming to run a live probe cannot.

## CRE

- Research the current API rather than coding from memory.
- If the simulation cannot run, report what blocked it and do **not** fabricate a
  log. (It was blocked at first, and the honest auth transcript was committed
  before a later fix made a real run possible.)

## Sandwich harness

- Sepolia only, chain id checked in one place with its own test.
- May only target our own probe addresses, resolved from the probe table. A guard
  in code with its own test, never a config flag.
- Rows it produces are marked `staged` and excluded from every route score.
- Investigate ordering rather than assuming it. Report the measured success rate,
  not an assumed one. (It reported 1 in 2 with a retry, which is why the demo plan
  says to record several takes.)
