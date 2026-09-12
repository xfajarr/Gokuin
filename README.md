# 極印 Gokuin

**Best execution for transaction promises.**

*Gokuin* (極印) is the mark struck into metal to certify what it actually is. *極印を押される* — to be branded permanently.

Every route you can send an Ethereum transaction through sells a promise: private, unsandwiched, fast, rebated. Nobody neutral checks. Gokuin probes each route with real transactions, records what actually happened, and stamps a mark that cannot be removed.

In Britain a Proof House has been legally required since 1637: every firearm is test-fired with a deliberately overcharged round by an independent body before it can be sold, then stamped. The maker is forbidden from testing its own. Ethereum's transaction routes have no such institution.

## Status

Built for ETHOnline 2026 · From Scratch · The Graph, ENS, Chainlink.
See [PRD.md](./PRD.md) for the full spec.

## What is live, what is not

Nothing below is claimed unless it runs. The distinction matters more here than
in most projects, because this one exists to say other people's claims are not
checked.

**Verified against real mainnet data**

- `contracts/test/ForkDerive.t.sol` forks mainnet at block 22450092, replays the
  victim's identical calldata, and derives `extractedWei = 12913434669342331`.
  It is not a mock; run it with
  `MAINNET_RPC=https://eth.drpc.org forge test --match-test testFork_DeriveKnownSandwich`.
- The fixture it uses is a real historical sandwich, verified independently by
  fetching receipts and decoding the Swap logs rather than trusting the paper that
  reported it. See `substreams/fixtures/known-sandwich.md`.
- `packages/core/test/sandwich-fixture.test.ts` derives the same number off-chain.
  The two must agree; that is the point.

**Builds and runs, not yet deployed**

| | State |
|---|---|
| `contracts/` | 23 tests pass. **No Sepolia deployment yet** |
| `substreams/` | compiles to a real WASM artifact. **Not published to Substreams registry** |
| `subgraph/` | `graph build` succeeds. **Not deployed to Subgraph Studio**; contract address is a placeholder pending deployment |
| `cre/` | `cre workflow build` produces a real 2.6MB WASM. `cre workflow simulate` is blocked by Chainlink account auth — see `cre/simulation/05-simulate-auth-gate.log` for the real transcript. **No simulation was fabricated** |
| `apps/api` | runs; chain writes are dry-run without keys |
| `apps/listener` | runs; replays a labelled fixture stream without `MAINNET_WS` |
| `apps/web` | builds and serves |
| `apps/mcp` | runs over stdio and HTTP |

**Designed, specified, not built**

`Dispute` — the bond-and-challenge contract that makes Gokuin accountable in its
own ledger. The economic argument in `docs/credibility.md` §5 depends on it and it
is not deployed. TEE-attested listeners and automated third-party archive
cross-checks are likewise specified but not wired.

**No probe has run on mainnet.** The funding, dispatch, observation and settlement
paths are all implemented and tested, but they need a funded key. Until then every
number you see in the UI is sample data, always behind a visible banner.

## We do not sell routing

The entire argument is that a router cannot audit its own suppliers. Gokuin takes no money from any relay, and operates no route. If that ever changes, the project is over.

## Layout

| Path | What |
|---|---|
| `packages/core` | measurement definitions — imported by every other layer |
| `contracts/` | Foundry: ProbeLedger, RouteRegistry (ENSv2), Scorer |
| `substreams/` | Rust `sandwich-detect` module |
| `subgraph/` | Substreams-powered subgraph |
| `apps/api` | ElysiaJS — cycle orchestration, observation ingest, scoring reads |
| `apps/listener` | standalone mempool listener, deployed per region |
| `apps/web` | TanStack Start — scoreboard, probe detail, method |
| `apps/mcp` | MCP server — `gokuin_submit` |
| `packages/abi` | ABIs generated from `forge build`. Never hand-written |
| `cre/` | Chainlink CRE Confidential Workflow — secret scoring weights |
| `docs/` | metrics (generated), credibility, architecture |

## Verify it yourself

```
bun install
bun run verify          # TypeScript tests, Foundry build and tests, web and mcp builds
```

Add `MAINNET_RPC` to also run the fork test that pins the arithmetic.

## Networks

Probes run on **mainnet** — a testnet sandwich proves nothing. ENSv2 is Sepolia-only in beta, so contracts live on **Sepolia** and every row carries the mainnet hash it indexes. The evidence is the mainnet hash; where we index it does not change what anyone can verify.
