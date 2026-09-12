# Fixture: known clean block

A block that provably contains **no** sandwich in the pool of interest --
the negative control for `known-sandwich.md`.

## Identity

| Field | Value |
|---|---|
| Chain | Ethereum mainnet |
| Block | **22450094** (the block immediately AFTER the known-sandwich fixture, same pool) |
| Pool of interest | `0x8d02988296949cd054623802c1115973a9afe307` (Uniswap V2 WETH/RATO) |

## Why this is clean

The pool emits **zero** logs at all in this block -- no `Swap`, no
`Mint`/`Burn`/`Sync`, nothing:

```bash
RPC=https://eth.drpc.org
cast logs --rpc-url $RPC --from-block 22450094 --to-block 22450094 \
  --address 0x8d02988296949cd054623802c1115973a9afe307 --json
# -> []
```

Zero swaps on the pool trivially means zero sandwiches on the pool: the
heuristic needs at least three swap legs on the same pool in the same
block (A, V, B) to fire, and there are none. This is the strongest
possible "no sandwich" argument -- it doesn't rely on judgment calls about
what does or doesn't count, only on the absence of any candidate
transactions whatsoever.

(For completeness: block 22450092, the block immediately BEFORE the
sandwich, is equally clean by the same test -- the pool was quiet on both
sides of the attack block.)

## How to reproduce

```bash
make run-clean   # substreams run ... map_sandwiches -s 22450094 -t +1
```

**Expected `map_sandwiches` output for block 22450094:** an empty
`Sandwiches.items` list (the module may still emit `Sandwich` entries for
*other* pools that happen to be sandwiched in this same block by
coincidence -- that's fine and expected, since the module is generic and
scans every pool, not just the one in this fixture. What must NOT appear
is any `Sandwich` whose `pool` field is
`0x8d02988296949cd054623802c1115973a9afe307`).
