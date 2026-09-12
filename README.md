# 極印 Gokuin

**Best execution for transaction promises.**

*Gokuin* (極印) is the mark struck into metal to certify what it actually is. *極印を押される* — to be branded permanently.

Every route you can send an Ethereum transaction through sells a promise: private, unsandwiched, fast, rebated. Nobody neutral checks. Gokuin probes each route with real transactions, records what actually happened, and stamps a mark that cannot be removed.

In Britain a Proof House has been legally required since 1637: every firearm is test-fired with a deliberately overcharged round by an independent body before it can be sold, then stamped. The maker is forbidden from testing its own. Ethereum's transaction routes have no such institution.

## Status

Built for ETHOnline 2026 · From Scratch · The Graph, ENS, Chainlink.
See [PRD.md](./PRD.md) for the full spec.

## What is live vs simulated

Filled in before submission. Nothing here is claimed until it runs.

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

## Networks

Probes run on **mainnet** — a testnet sandwich proves nothing. ENSv2 is Sepolia-only in beta, so contracts live on **Sepolia** and every row carries the mainnet hash it indexes. The evidence is the mainnet hash; where we index it does not change what anyone can verify.
