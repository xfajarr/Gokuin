> **Verified with the real detector, not a port.** The harness's own
> `detect-replica.ts` is a TypeScript restatement of the heuristic and proves
> nothing on its own — a port that agrees with itself is not evidence. The
> published Substreams module was run against the staged block directly:
>
> ```
> substreams run substreams.sepolia.yaml map_sandwiches \
>   -e sepolia.eth.streamingfast.io:443 -s 11693970 -t +1
> ```
>
> It returns the same three hashes and the same indices 1 / 2 / 7.
>
> One honest note: `attackerRoundTripWei` came back `0`. The staged attacker made
> no profit on the round trip — a small trade against a thin pool, with gas. That
> figure is a best-effort proxy anyway; the number that counts is the ledger's
> victim-side `extractedWei` (`simOut - realOut`), which is computed elsewhere.

# sandwich-harness

Standalone Bun + TypeScript tool that stages a real sandwich attack against
Gokuin's own probe address on **Sepolia testnet**, so the demo can show the
detection path working end to end without waiting for an organic sandwich
that cannot be scheduled. See `PRD.md` §1 and §12, and `docs/credibility.md`
("The sandwich in the demo video is one we caused") for why this exists and
why it does not compromise anything the project claims about real routes.

Not in `apps/` — it is not part of the running system. It is a fire drill.

**This has been run for real.** See "What actually happened on Sepolia"
below for the three real transaction hashes, the block they landed in, and
confirmation that the detection heuristic flags them.

---

## The three guards, and why each exists

### 1. Sepolia only — `src/guards/chain-guard.ts`

Hard-coded to chain id `11155111`. `assertSepolia()` calls `eth_chainId`
against whatever RPC is configured and throws `WrongChainError` on anything
else — mainnet included. There is no environment variable that changes this;
the function reads the truth back from the endpoint itself, not from
whatever `SEPOLIA_RPC` happens to be named. Test: `test/chain-guard.test.ts`
(rejects chain ids 1, 8453, 31337; accepts only 11155111).

### 2. Only our own probe addresses — `src/guards/victim-guard.ts`

`resolveProbeVictim()` looks the target address up in apps/api's own SQLite
`probe` table (the real one, via `../../../apps/api/src/db.ts` — not a copy),
falling back to `KNOWN_PROBE_ALLOWLIST`, a short hardcoded array in that same
file. Neither source is env-driven. If neither recognises the address, it
throws `UnknownVictimError` and nothing downstream runs. Test:
`test/victim-guard.test.ts` (refuses an unregistered address, resolves one
once it's in the probe table or the allowlist, case-insensitive, and an empty
probe table is not an open door).

### 3. Everything this harness produces is staged — `src/db.ts`, `src/row.ts`

`registerStagedProbe()` inserts the probe row with `staged = 1` in the same
statement that creates it — there is no window where it exists unstaged.
`buildStagedRow()` (`src/row.ts`) always produces a `Row`
(`packages/core/src/types.ts`) with `staged: true`, mirroring exactly what
`apps/api/src/derive/settle.ts` would build for this probe (`staged:
probe.staged === 1`). `packages/core/src/metrics.ts`'s `scoreRoute()` already
excludes staged rows from every ratio and total —
`packages/core/test/staged-exclusion.test.ts` pins that in the abstract; this
harness's own `test/staged-row.test.ts` pins it **end to end**, using the
real shape this harness produces: a staged row inserted into the real schema
reads back `staged=1`, and a `Row` built from a real victim tx hash with
`sandwiched: true` still leaves `scoreRoute()`'s `sandwichBps`,
`totalExtractedWei`, and `probes` completely unmoved, with `stagedExcluded`
counting it explicitly.

None of these three guards is a config flag. Changing any of them means
changing and reviewing source code.

---

## Sepolia deployment used

Uniswap V3 is officially deployed on Sepolia; Uniswap's own Universal Router
deployment notes state V2 is **not** supported there, and no V2
factory/router with real paired liquidity could be found. So this harness
uses V3, against a pool with genuine, non-zero liquidity — no pool
deployment or liquidity seeding was necessary. Every address below was
verified with `cast call` against `$SEPOLIA_RPC` before being written into
`src/chain/addresses.ts` (not copied from a list on trust):

| Contract | Address | Verified how |
|---|---|---|
| Uniswap V3 Factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` | `router.factory()` returns this exact address |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` | `router.WETH9()` returns WETH9 below; `router.factory()` returns the factory above |
| WETH9 | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | `router.WETH9()`; `decimals()` = 18 |
| Test USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `symbol()` = "USDC", `decimals()` = 6 |
| WETH/USDC 0.05% pool | `0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1` | `factory.getPool(USDC, WETH, 500)` returns this address; pool's own `token0()`/`token1()` match; `liquidity()` returns a large non-zero value (also visible on GeckoTerminal, independently) |

```bash
cast call 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E "factory()(address)" --rpc-url $SEPOLIA_RPC
# -> 0x0227628f3F023bb0B980b67D528571c95c6DaC1c
cast call 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E "WETH9()(address)" --rpc-url $SEPOLIA_RPC
# -> 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
cast call 0x0227628f3F023bb0B980b67D528571c95c6DaC1c "getPool(address,address,uint24)(address)" \
  0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14 500 --rpc-url $SEPOLIA_RPC
# -> 0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1
cast call 0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1 "liquidity()(uint128)" --rpc-url $SEPOLIA_RPC
# -> 16300844130308708 (non-zero — a real, live pool)
```

`substreams/substreams.sepolia.yaml`'s `initialBlock: 3518270` is the V3
factory's own deployment block on Sepolia, found by binary-searching
`cast code $FACTORY --block N` for the first block with non-empty code.

---

## Routes on Sepolia (for anyone extending this harness toward leak testing)

This harness only ever uses `public-mempool` — the victim transaction must be
visible in the public mempool for the front-run to react to it at all, so
that is the only truthful route label for what it does (see
`src/db.ts:registerStagedProbe`). Two things worth recording here for
whoever builds on this next:

- **`flashbots-protect` is real on Sepolia**, not mainnet-only. Both
  `https://rpc-sepolia.flashbots.net` and
  `https://relay-sepolia.flashbots.net/fast` answer `eth_chainId` with
  `0xaa36a7` (11155111). That means the leak metric (does a transaction sent
  through the "protected" endpoint show up in the public mempool before
  inclusion anyway) is genuinely measurable on Sepolia, not just simulated.
- **`mev-blocker` has no Sepolia equivalent.** `https://rpc.mevblocker.io`
  answers `eth_chainId` with `0x1` (mainnet); `sepolia.mevblocker.io`,
  `rpc-sepolia.mevblocker.io`, and `rpc.mevblocker.io/sepolia` do not respond
  at all. This harness does not fabricate one. Anything that scores routes
  must render `mev-blocker` on Sepolia as **no data** (`probes: 0`) — never as
  a clean record — which is exactly what `packages/core/src/metrics.ts`'s
  `scoreRoute()` already does for a route with zero rows;
  `packages/core/test/staged-exclusion.test.ts`'s "a route of nothing but
  staged rows reports zero probes, not a clean record" pins the same
  principle for a different reason. Do not point anything at a made-up
  `sepolia.mevblocker.io`.

---

## Ordering: what was tried and how reliable it is

Sepolia has no working Flashbots bundle inclusion path today (see next
section), so this harness's real ordering mechanism is **gas priority
laddering** (`src/sandwich/fee-ladder.ts`): the front-run gets the highest
`maxPriorityFeePerGas` (6 gwei), the victim a medium one (3 gwei), the
back-run the lowest (1.5 gwei), all comfortably above the current base fee.
Public block builders order transactions from distinct senders by effective
tip, highest first — that ordering is exactly A < V < B.

**Measured, not assumed:**

- Five rounds of two simple self-transfers (attacker high-tip, victim
  low-tip, fired within milliseconds of each other): **5/5 landed in the same
  block, in the intended order.**
- The real three-leg swap-based sandwich (`bun src/cli.ts run`), which is
  strictly harder because the back-run depends on the front-run's exact
  output: **1/2 attempts** landed correctly on the first live end-to-end
  run — attempt 1 landed all three in the same block but in the wrong
  relative order (`orderedCorrectly=false`); the harness's own retry loop
  (`--attempts`) caught this and attempt 2 landed correctly. This is real
  evidence for exactly what the fee ladder is: a strong heuristic worth
  retrying on, not a guarantee — which is why `cli.ts run` retries by default
  rather than treating the first attempt as final.

### Flashbots bundles: investigated, wired up, and empirically unreliable on Sepolia today

Per instruction, this was checked rather than assumed either way.
`src/sandwich/bundle.ts` implements real `eth_sendBundle` submission with a
proper `X-Flashbots-Signature` header, and `cli.ts run --bundle` tries it
before falling back to the fee ladder. What was found, in order:

1. Both `https://relay-sepolia.flashbots.net` and
   `.../fast` report chain id `0xaa36a7` (Sepolia).
2. `eth_sendBundle` is a real, recognised method there: an **unsigned**
   request is rejected with `{"code":-32600,"message":"signature is
   required"}` — not "method not found". A **properly signed** request with
   syntactically-invalid tx bytes gets past signature verification to
   `{"code":-32600,"message":"incorrect request"}`, proving the relay
   actually parses and validates bundle contents.
3. A real, validly-signed two-transaction bundle, submitted to six
   consecutive upcoming block numbers, was accepted every time (a stable
   `bundleHash` returned) but **did not land in any of those six blocks**, nor
   within roughly two more minutes of polling afterward.

This matches a publicly reported issue
([`flashbots/rbuilder#862`](https://github.com/flashbots/rbuilder/issues/862),
"[BUG] Flashbots Relayer [SEPOLIA]"): validator/builder participation in the
Flashbots MEV-Boost relay on Sepolia is sparse, so a bundle can be entirely
valid and still never get built into a block. **Conclusion: bundle
submission is real and worth trying (it is exactly the technique mainnet
searchers use, and this harness genuinely attempts it), but it is not, today,
a reliable ordering mechanism on Sepolia — gas-priority laddering is,
measured at 5/5 and then 1/2-with-successful-retry above.** `cli.ts run
--bundle` tries the bundle path with a 45-second timeout across 4 target
blocks, then automatically falls back to laddering; `run` (no flag) skips
straight to laddering, which is the path actually used for the verified run
below.

---

## Why `amountOutMinimum` is 0 on every swap

The goal is a correctly-ordered, detector-matching sandwich, not a
profitable one — the detector's `sandwiched` verdict is a pattern match on
ordering/direction/hashes (see next section), not on profit. A slippage
floor here would only add a way for the demo to revert over "profit" that
has no monetary meaning on testnet ETH anyway.

## A bug this harness hit for real, and how it was fixed

The first live attempt (probe id 1, victim tx
`0xfcd14d1807d81111d9306c5f8ac1a1dd47e4152eca602a553550162bb50f750c`, block
`11693959`) landed all three transactions in the correct order — but the
back-run **reverted** (status 0, zero logs). Cause: the back-run's
`amountIn` was built from the front-run's WETH-scaled (18-decimal) input
amount instead of the USDC it would actually receive (6-decimal), asking the
router to move roughly a billion times more USDC than the attacker held.
Fixed in `src/sandwich/quote.ts`: before signing the back-run, this harness
now simulates the front-run's `exactInputSingle` call (`eth_call`, no state
change, no gas) to learn the real expected USDC output, and uses 99% of that
figure as the back-run's `amountIn`. Documented here because a harness that
hides its own bugs is exactly what this project argues against.

---

## What actually happened on Sepolia

Run with `bun src/cli.ts run --attempts=5` (fee-ladder path; see above for
why bundles were tried and set aside). Landed on the second attempt:

| Leg | Tx hash | Index in block |
|---|---|---|
| Front-run | [`0x7b283b3890f535f1ad229669998846388281a67478c18e5c68eab9b9f72109f5`](https://sepolia.etherscan.io/tx/0x7b283b3890f535f1ad229669998846388281a67478c18e5c68eab9b9f72109f5) | 1 |
| Victim (our own probe) | [`0xf6833083c21d1a6335e6e63b95364e72afa4f8e9bfb1cb34c3c0d71d895c1d4f`](https://sepolia.etherscan.io/tx/0xf6833083c21d1a6335e6e63b95364e72afa4f8e9bfb1cb34c3c0d71d895c1d4f) | 2 |
| Back-run | [`0x379858504f6ecba69cee80cc16bf54e962598a0d3cb4abc5686388df5516ab7e`](https://sepolia.etherscan.io/tx/0x379858504f6ecba69cee80cc16bf54e962598a0d3cb4abc5686388df5516ab7e) | 7 |

Block: [`11693970`](https://sepolia.etherscan.io/block/11693970) — a judge
can open that link and see all three transactions, in that order, touching
the same pool, from the two addresses below.

- Victim / probe address: `0xD6499869a0d8f5bbc23e919445f5E3e1a8CC0e77` (this
  repo's `PROBER_ADDRESS`, in `KNOWN_PROBE_ALLOWLIST`)
- Attacker address (generated by this harness, testnet-only key, no value):
  `0x73261B963E7aaF044283fD6BbC826315e9451631`

`apps/api/gokuin.db`'s `probe` table row for this run (id 2) has
`staged = 1`, `tx_hash` = the victim hash above, `route = 'public-mempool'`.

### Detector verification: what was actually run

The real production path is `substreams run` against a Substreams package —
`substreams/substreams.sepolia.yaml` (see below) — streamed from a
StreamingFast/Pinax/thegraph.market endpoint that needs `SUBSTREAMS_API_KEY`.
That key is blank in this environment's `.env`
(`.env.example`'s own comment: "Free tier from streamingfast.io,
pinax.network, or thegraph.market"), so the actual hosted pipeline was not
run against this block. Rather than skip verification, `src/sandwich/detect-replica.ts`
re-implements the **exact same heuristic** as `substreams/src/lib.rs` — same
ordering rule (A before V before B), same opposite-direction check, same
same-from / distinct-hash check on the attacker pair, same "tightest
enclosing pair per victim" tie-break — and runs it directly against the real
mined block via `eth_getLogs` + `eth_getTransaction` over `$SEPOLIA_RPC`.
This is not a mock: it reads the actual Sepolia chain state for block
`11693970`.

```
$ bun src/cli.ts detect 11693970
[
  {
    "victimTxHash": "0xf6833083c21d1a6335e6e63b95364e72afa4f8e9bfb1cb34c3c0d71d895c1d4f",
    "frontrunTxHash": "0x7b283b3890f535f1ad229669998846388281a67478c18e5c68eab9b9f72109f5",
    "backrunTxHash": "0x379858504f6ecba69cee80cc16bf54e962598a0d3cb4abc5686388df5516ab7e",
    "attacker": "0x73261b963e7aaf044283fd6bbc826315e9451631",
    "victim": "0xd6499869a0d8f5bbc23e919445f5e3e1a8cc0e77",
    "frontrunIndex": 1,
    "victimIndex": 2,
    "backrunIndex": 7
  }
]
```

**The detector flags it, using the exact hashes above.** Anyone with a
`SUBSTREAMS_API_KEY` can independently confirm the same result by running
`substreams run substreams/substreams.sepolia.yaml map_sandwiches -s 11693970
-t +1` — the module code and protobuf schema are identical to what
`detect-replica.ts` reimplements in TypeScript; only the manifest's `network`
and `initialBlock` differ from the mainnet package (see next section).

---

## Detector configuration: why a second manifest

`substreams/substreams.yaml` declares `network: mainnet`, correctly —
`PRD.md` §4 is explicit that probes (the real measurement) run on mainnet,
because a testnet sandwich against a real route proves nothing. That
manifest is untouched.

For the demo to be independently checkable against Sepolia, this repo now
also has `substreams/substreams.sepolia.yaml`: same Rust module
(`map_sandwiches`, `graph_out`), same `.wasm` binary, same protobuf schema —
only `network: sepolia` and `initialBlock: 3518270` (the Sepolia V3 factory's
own deployment block, found empirically — see above) differ. Substreams
pins one manifest to one chain, so a single manifest cannot serve both
networks; a second manifest is the smallest change that does not touch a
single line of `src/lib.rs`. The V2/V3 Swap-log decoding takes no address and
branches on nothing chain-specific, so the identical `.wasm` is correct
against Sepolia blocks without modification — the pool it found
(`0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1`) emits the exact same
`Swap(address,address,int256,int256,uint160,uint128,int24)` topic0 the
mainnet module already decodes.

**On the subgraph:** The Graph Studio no longer accepts
substreams-powered subgraphs ("Substreams-powered Subgraphs, originally
intended for non-EVM chains, are no longer supported."), so
`substreams.sepolia.yaml` is not wired to any subgraph — it is meant to be
consumed standalone (`substreams run`, or `substreams gui`), the same way
`map_sandwiches` itself has always been consumable independent of
`graph_out` (see `substreams/README.md`'s "entity-changes vs
substreams-triggers"). This harness's own `detect-replica.ts` is the
standalone consumer used for this task; `apps/api` is being reworked
separately to read Substreams output directly rather than through a
subgraph.

---

## Reproduction sequence

```bash
# 1. Generate + fund a fresh attacker key with Sepolia ETH (testnet-only, no value)
export ATTACKER_PK=<generatePrivateKey() output>
# send ~0.02 Sepolia ETH to that key's address from a funded key, e.g. DEPLOYER_PK

# 2. One-time prep: wrap ETH into WETH and approve the router for both accounts
bun src/cli.ts setup

# 3. Dry run first: builds and signs all three legs, prints them, broadcasts nothing
bun src/cli.ts dry-run

# 4. The real thing (fee-ladder path, retries automatically on bad ordering)
bun src/cli.ts run --attempts=5
# or, to genuinely attempt a Flashbots bundle first (see "Ordering" above for why
# this will likely time out and fall back):
bun src/cli.ts run --bundle --attempts=5

# 5. Independently confirm the detector flags the landed block
bun src/cli.ts detect <blockNumber>
```

Every command starts by printing `[chain-guard]` and `[victim-guard]`
confirmations — if either guard would fail, the command exits before
touching anything else.

---

## Staged, and excluded — the whole point

Every row this harness produces has `staged = 1` in `apps/api`'s real
`probe` table (see constraint 3 above) and every `Row` it builds for
`ProbeLedger` carries `staged: true`. `scoreRoute()` in
`packages/core/src/metrics.ts` excludes staged rows from every ratio and
total it computes — sandwiches, leaks, extracted value, probe counts, all of
it — and reports how many it withheld via `stagedExcluded` so the exclusion
is visible rather than silent. **This demo sandwich is evidence that the
detector works. It is not, and must never be read as, evidence about any
route's real sandwich rate.** `test/staged-row.test.ts` verifies this
end to end using the exact hashes and row shape this harness produced live,
not just a synthetic fixture.

---

## Tests

```bash
bun test   # from this directory, or `bun test` at the repo root (tools/* is a workspace)
```

- `test/chain-guard.test.ts` — constraint 1
- `test/victim-guard.test.ts` — constraint 2
- `test/staged-row.test.ts` — constraint 3, end to end

All three, plus the rest of the repo's suite, run under `bun run verify`
from the repo root (`tools/*` was added to root `package.json`'s
`workspaces` so `bun test` at the root discovers and links this package
properly — a one-line addition, no other root file changed).
