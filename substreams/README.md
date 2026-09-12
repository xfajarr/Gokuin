# sandwich-detect

A generic Uniswap V2/V3 sandwich-attack detector, written as a Rust
Substreams module. It takes no address parameter and hardcodes none: it
scans every mainnet block for the front-run/victim/back-run pattern on
every pool, and emits one `Sandwich` record per victim it finds. Point it
at your own wallet's transaction history after the fact -- or anyone
else's -- by filtering the output stream for `attacker` or `victim`.

This is Gokuin's answer to The Graph's *"reusable infrastructure, not a
one-off app"* bar: nothing here is specific to Gokuin's own probes.

## The heuristic

Must match `packages/core/src/metrics.ts`'s `SandwichVerdict` and
`PRD.md` §11 exactly:

> A front-run transaction A at index i, a victim V at index j > i, a
> back-run B at index k > j -- all in the SAME block, touching the SAME
> pool, with A and B in OPPOSITE directions, distinct hashes, and
> `A.from == B.from`.

Implementation (`src/lib.rs`):

1. Decode every Uniswap V2 (`Swap(address,uint256,uint256,uint256,uint256,address)`)
   and V3 (`Swap(address,address,int256,int256,uint160,uint128,int24)`) log in
   the block into a `SwapLeg { tx_index, tx_hash, from, pool, direction,
   amount_in, amount_out }`. Both event signatures were confirmed against
   the actual keccak256 topic0 with `cast sig-event` rather than trusted
   from memory -- see the constants at the top of `src/lib.rs`.
2. Group legs by pool, preserving block order.
3. For each pool, find every candidate attacker pair `(i, k)` with
   `i < k`, `legs[i].from == legs[k].from`, opposite `direction`, and
   distinct tx hashes.
4. For each possible victim position `j`, pick the *tightest* enclosing
   pair (smallest `k - i` span) as that victim's sandwich. This keeps
   output to one `Sandwich` per victim even when multiple candidate pairs
   could bracket it.
5. `extractedWei` is a **best-effort** proxy, not the ledger's
   `simOut - realOut` definition (that one requires an `eth_call` against
   pre-transaction state, which a Substreams map module has no way to
   perform -- it only sees the block that already happened). Because A
   and B are opposite-direction swaps, `B.amount_out` and `A.amount_in`
   are denominated in the same token by construction; the proxy is
   `max(0, B.amount_out - A.amount_in)` -- what the attacker got back on
   the round trip minus what they put in, before gas. See
   `fixtures/known-sandwich.md` for a worked example where this is
   compared against third-party numbers.

**Known limitation:** if a single transaction emits more than one Swap log
against the same pool (a multi-hop route touching the pool twice), only
the first such log is used for that transaction. Documented, not silently
wrong.

## Two modules, on purpose

| Module | Output | Purpose |
|---|---|---|
| `map_sandwiches` | `gokuin.sandwich.v1.Sandwiches` (our own proto, `proto/sandwich.proto`) | The actual detector. Domain-specific, Graph-agnostic. Anyone can run this standalone with `substreams run` or consume it from non-Graph tooling. |
| `graph_out` | `sf.substreams.sink.entity.v1.EntityChanges` | A thin adapter, `inputs: [{map: map_sandwiches}]`, that turns `Sandwiches` into the entity mutations graph-node's substreams sink expects. |

**Why entity-changes, not "substreams triggers":** the task brief allowed
either. We use the **entity-changes** convention (`kind:
substreams/graph-entities` in `subgraph/sandwich-subgraph/subgraph.yaml`,
built with the well-documented `substreams-entity-change` crate) because
it is the stable, widely-deployed mechanism (e.g. StreamingFast's own
Uniswap V3 substreams-subgraph uses exactly this shape) with a clear
spec (GIP-0053). A "custom AssemblyScript handler triggered directly by
an arbitrary Substreams output type" mechanism does exist in some
discussions of Substreams' roadmap, but isn't a stable, documented
contract we could verify precisely -- not something to build a judged
deliverable on. Keeping `map_sandwiches` free of any Graph-specific
dependency, and pushing all graph-node-shape knowledge into the separate
`graph_out` adapter, gets us the reusability goal either way.

**Constraint that shaped `subgraph/`'s layout:** per GIP-0053, *"Subgraphs
with a substreams dataSource can only have that single dataSource."* That
means the Sepolia `ProbeLedger` event indexing (a normal
`kind: ethereum/contract` datasource) cannot live in the same
`subgraph.yaml` as this module's `kind: substreams` datasource. See
`subgraph/README.md` for how the two are split.

## Build

Requires Rust with the `wasm32-unknown-unknown` target:

```bash
rustup target add wasm32-unknown-unknown   # matches rust-toolchain.toml
cd substreams
make build      # cargo build --target wasm32-unknown-unknown --release
```

Proto codegen happens automatically at build time via `build.rs` (uses
`prost-build` with a vendored `protoc` from `protoc-bin-vendored` -- no
system `protoc` or `substreams protogen` CLI step required). This was
verified to actually compile in this environment: `cargo build --target
wasm32-unknown-unknown --release` produces
`target/wasm32-unknown-unknown/release/sandwich_detect.wasm`.

## Pack

Requires the [`substreams` CLI](https://substreams.streamingfast.io/documentation/consume/installing-the-cli):

```bash
make pack       # substreams pack ./substreams.yaml -o sandwich-detect-v0.1.0.spkg
```

## Run

Requires a Substreams endpoint (StreamingFast/Pinax/thegraph.market all
provide free-tier mainnet endpoints; get a token at
https://substreams.dev):

```bash
make run ENDPOINT=mainnet.eth.streamingfast.io:443 BLOCKS=22450093:+1
```

### Validating the module

Two pinned fixtures back this module before anyone should trust it live:

- `fixtures/known-sandwich.md` -- block **22450093**, a real,
  independently re-derived-from-chain WETH/RATO sandwich (front-run,
  victim and back-run tx hashes, pool, attacker address all pinned).
  `make run-sandwich` must emit exactly one `Sandwich` matching those
  hashes.
- `fixtures/known-clean.md` -- block **22450094**, the block right after
  it, where the same pool emits zero logs at all. `make run-clean` must
  emit no `Sandwich` with `pool = 0x8d02988296949cd054623802c1115973a9afe307`.

```bash
make run-sandwich   # expect: 1 Sandwich, see fixtures/known-sandwich.md for exact hashes
make run-clean      # expect: no Sandwich on the fixture pool, see fixtures/known-clean.md
```

## Asking "was I sandwiched?" for any address

This module emits every sandwich in every block -- it does not take an
address parameter (Substreams map modules are pure functions of block
data; parameterizing by address would mean re-running the whole chain per
query, which is what a downstream index -- the subgraph in
`subgraph/sandwich-subgraph/` -- is for). To check a specific wallet:

```graphql
{
  sandwiches(where: { victim: "0xYOUR_ADDRESS" }) { id block pool attacker extractedWei }
  # or, to see if this address ever ran the play:
  sandwichesAsAttacker: sandwiches(where: { attacker: "0xYOUR_ADDRESS" }) { id block pool victim extractedWei }
}
```

against the deployed `sandwich-subgraph` (see `subgraph/README.md`).
