# Fixture: known sandwich

A real, documented Uniswap V2 sandwich attack, independently re-derived from
raw chain data (not taken on faith from the write-up) to confirm
`sandwich-detect`'s heuristic actually fires on it.

## Identity

| Field | Value |
|---|---|
| Chain | Ethereum mainnet |
| Block | **22450093** |
| Block timestamp | 2025-05-10T02:40:59Z (`Sat, 10 May 2025`) |
| Pool | `0x8d02988296949cd054623802c1115973a9afe307` (Uniswap V2 pair, factory `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`) |
| token0 | WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| token1 | RATO ("Rato The Rat") `0xf816507E690f5Aa4E29d164885EB5fa7a5627860`, 9 decimals |
| Front-run (A) | tx index **10**: `0xa91b3f3ae036bcad07ee72df22a27ad5bfb5127b88a24301e3b7825868ae0286` |
| Victim (V) | tx index **11**: `0x7c2d07b87c34605b08b15dccb9e01d403146b9c87d7c1b0ea3ce789a2f9b4252` |
| Back-run (B) | tx index **12**: `0x989e2455430f20811de6682e95a7b87d2585305fb12627895a4df032f795cbe7` |
| Attacker (A.from == B.from) | `0xbabe01c4a05038010c3ced0281a732718a4d5701` |
| Victim's `from` | `0x589437c4e91029c830217890107aebb545768dd3` |

## Why this satisfies the heuristic

Decoding the three `Swap(address,uint256,uint256,uint256,uint256,address)`
logs emitted by the pool in this block (topic0
`0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822`):

| tx index | from | direction | amount in | amount out |
|---|---|---|---|---|
| 10 (A) | `0xbabe...5701` | WETH→RATO | 1.586925081903235072 ETH | 319,495,865.863503872 RATO |
| 11 (V) | `0x5894...68dd3` | WETH→RATO | **0.83 ETH** | 157,358,171.477322859 RATO |
| 12 (B) | `0xbabe...5701` | RATO→WETH | 319,495,865.863503872 RATO | 1.641603894473654272 ETH |

- A at i=10, V at j=11, B at k=12, all in block 22450093, all on pool
  `0x8d0298...9afe307`: **i < j < k, same block, same pool.** ✅
- A is WETH→RATO ("0for1"), B is RATO→WETH ("1for0"): **opposite
  directions.** ✅
- Three distinct transaction hashes. ✅
- `A.from == B.from == 0xbabe01c4a05038010c3ced0281a732718a4d5701`. ✅
- A's RATO output (319,495,865.863503872) exactly equals B's RATO input:
  the attacker round-tripped the exact amount they front-ran with.

This is the textbook shape: front-run buys ahead of the victim's order,
pushing the price the victim pays; back-run immediately sells the same
tokens back once the victim's trade has moved the price further in the
attacker's favor.

**Best-effort extractedWei** (this module's heuristic: `B.amount_out -
A.amount_in`, in the round-tripped token, floored at zero):
`1.641603894473654272 - 1.586925081903235072 = 0.054678812570419200 ETH`
(≈ `54678812570419200` wei). This is a *gross* round-trip figure computed
purely from swap amounts, not the ledger's `simOut - realOut` definition
(which needs an `eth_call` against pre-transaction state and gas
accounting) -- it does not subtract the attacker's gas cost. Third-party
analysis of this same block (see Source) reports a *net* attacker profit of
roughly $4.32 after gas, because the back-run's priority fee was
unusually high (most of the extracted value went to the block builder, not
the attacker) -- consistent with our larger gross figure.

## How to reproduce independently

This fixture was **not** taken from the source article's numbers -- the
exact transaction hashes, addresses and wei amounts above were re-derived
directly from mainnet via RPC before being written down here:

```bash
RPC=https://eth.drpc.org   # any full archive/history node works; publicnode's
                           # eth_getTransactionReceipt was flaky when this was built

# Confirm the pool is a genuine Uniswap V2 pair off the canonical factory
cast call 0x8d02988296949cd054623802c1115973a9afe307 "factory()(address)" --rpc-url $RPC
# -> 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f  (Uniswap V2: Factory)

# Pull every Swap log the pool emitted in the block and decode amounts
cast logs --rpc-url $RPC --from-block 22450093 --to-block 22450093 \
  --address 0x8d02988296949cd054623802c1115973a9afe307 --json
```

Or run the module itself (see `../README.md` "Validating the module"):

```bash
make run-sandwich   # substreams run ... map_sandwiches -s 22450093 -t +1
```

**Expected `map_sandwiches` output for block 22450093:** exactly one
`Sandwich`, with
`victim_tx_hash = 0x7c2d07b87c34605b08b15dccb9e01d403146b9c87d7c1b0ea3ce789a2f9b4252`,
`frontrun_tx = 0xa91b3f3ae036bcad07ee72df22a27ad5bfb5127b88a24301e3b7825868ae0286`,
`backrun_tx = 0x989e2455430f20811de6682e95a7b87d2585305fb12627895a4df032f795cbe7`,
`attacker = 0xbabe01c4a05038010c3ced0281a732718a4d5701`,
`pool = 0x8d02988296949cd054623802c1115973a9afe307`.

## Source

- The Marginal Effects of Ethereum Network MEV Transaction Re-Ordering
  (arXiv:2508.04003), which analyses this exact block/pool/trade as a
  worked example: <https://arxiv.org/abs/2508.04003> (HTML:
  <https://arxiv.org/html/2508.04003v1>). Its Table 4 reports the same
  front-run/victim/back-run shape ("~1.59 ETH" front-run, "0.83 ETH"
  victim, "~1.64 ETH" back-run) that the on-chain data above reproduces
  precisely.
- Etherscan (for manual cross-checking): `https://etherscan.io/tx/0xa91b3f3ae036bcad07ee72df22a27ad5bfb5127b88a24301e3b7825868ae0286`,
  `https://etherscan.io/tx/0x7c2d07b87c34605b08b15dccb9e01d403146b9c87d7c1b0ea3ce789a2f9b4252`,
  `https://etherscan.io/tx/0x989e2455430f20811de6682e95a7b87d2585305fb12627895a4df032f795cbe7`.
