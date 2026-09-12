// Pinned fixtures for the sandwich-detection heuristic and the extractedWei
// metric. THE single source both test suites read:
//   - packages/core/test/sandwich-fixture.test.ts (this package)
//   - contracts/test/ForkDerive.t.sol (Solidity can't import TS, so that file
//     hardcodes the same numbers — it points back here in a comment)
// PRD.md §15: "the fork test and the TypeScript metric test consume the same
// fixture and must agree. If the contract and the API disagree about what a
// sandwich cost, the project has no product." This file is that agreement.
//
// Provenance: this is a REAL Ethereum mainnet sandwich, verified
// INDEPENDENTLY on-chain — not taken on faith from the paper that reported
// it. The block/pool/tx-hash identity and the per-leg amounts were re-derived
// by fetching the three transaction receipts and decoding the pool's
// `Swap(address,uint256,uint256,uint256,uint256,address)` logs directly via
// `cast receipt` / `cast logs` against `https://eth.drpc.org` (see
// substreams/fixtures/known-sandwich.md for the exact commands and raw
// output). Only after that independent re-derivation matched was it cross-
// referenced against "The Marginal Effects of Ethereum Network MEV
// Transaction Re-Ordering" (arXiv:2508.04003), Table 4, which analyses this
// same block/pool/trade as a worked example (~1.59 ETH front-run / 0.83 ETH
// victim / ~1.64 ETH back-run) — arXiv:2508.04003 is cited as the origin
// that pointed at this block, not as the source of the numbers below.
//
// simOut/realOut/extractedWei were derived separately (and later) from the
// above: by forking mainnet at `block - 1` and replaying the victim's exact
// transaction calldata against pre-front-run pool state in a Foundry test
// (contracts/test/ForkDerive.t.sol::testFork_DeriveKnownSandwich), then
// diffing against the real, already-decoded Swap-log output. See that file
// for the replay mechanics. Command used to reproduce:
//   MAINNET_RPC=https://eth.drpc.org forge test \
//     --match-test testFork_DeriveKnownSandwich -vv

type Address = `0x${string}`
type Hash = `0x${string}`

interface SandwichLeg {
  txHash: Hash
  txIndex: number
  pool: Address
  from: Address
}

/**
 * A real Uniswap V2 WETH/RATO sandwich at Ethereum mainnet block 22450093.
 * Amounts are raw on-chain units decoded straight from the pool's Swap logs
 * (WETH: 18 decimals, RATO: 9 decimals) — never rounded through floats.
 */
export const KNOWN_SANDWICH = {
  chain: 'ethereum-mainnet',
  block: 22450093,
  blockTimestamp: '2025-05-10T02:40:59Z',

  pool: '0x8D02988296949cd054623802c1115973A9AFE307' as Address, // Uniswap V2 WETH/RATO
  factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f' as Address,
  token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH, 18 decimals
  token1: '0xf816507E690f5Aa4E29d164885EB5fa7a5627860' as Address, // RATO, 9 decimals

  /** A.from == B.from — the sandwiching account. */
  attacker: '0xbabe01c4a05038010c3ced0281a732718a4d5701' as Address,
  /** The victim's own `from`, distinct from the attacker. */
  victimFrom: '0x589437c4e91029c830217890107aebb545768dd3' as Address,

  /** A — front-run: WETH -> RATO, opens the position ahead of the victim. */
  frontrun: {
    txHash: '0xa91b3f3ae036bcad07ee72df22a27ad5bfb5127b88a24301e3b7825868ae0286' as Hash,
    txIndex: 10,
    pool: '0x8D02988296949cd054623802c1115973A9AFE307' as Address,
    from: '0xbabe01c4a05038010c3ced0281a732718a4d5701' as Address,
    amountInWei: 1586925081903235072n, // WETH in
    amountOutRaw: 319495865863503872n, // RATO out
  } satisfies SandwichLeg & { amountInWei: bigint; amountOutRaw: bigint },

  /** V — the victim's own trade, sandwiched between A and B. */
  victim: {
    txHash: '0x7c2d07b87c34605b08b15dccb9e01d403146b9c87d7c1b0ea3ce789a2f9b4252' as Hash,
    txIndex: 11,
    pool: '0x8D02988296949cd054623802c1115973A9AFE307' as Address,
    from: '0x589437c4e91029c830217890107aebb545768dd3' as Address,
    amountInWei: 830000000000000000n, // 0.83 WETH in
    // RATO out, decoded from the pool's Swap log in the REAL block (i.e.
    // with the front-run already applied) — this is the `realOut` half of
    // the extractedWei calculation below.
    amountOutRaw: 157358171477322859n,
  } satisfies SandwichLeg & { amountInWei: bigint; amountOutRaw: bigint },

  /** B — back-run: RATO -> WETH, closes the position right after the victim. */
  backrun: {
    txHash: '0x989e2455430f20811de6682e95a7b87d2585305fb12627895a4df032f795cbe7' as Hash,
    txIndex: 12,
    pool: '0x8D02988296949cd054623802c1115973A9AFE307' as Address,
    from: '0xbabe01c4a05038010c3ced0281a732718a4d5701' as Address,
    amountInRaw: 319495865863503872n, // RATO in — exactly A's RATO out
    amountOutWei: 1641603894473654272n, // WETH out
  } satisfies SandwichLeg & { amountInRaw: bigint; amountOutWei: bigint },
} as const

/**
 * simOut/realOut/extractedWei for the victim's own trade — the metric
 * `computeExtracted()` (packages/core/src/metrics.ts) and
 * `ForkDerive.t.sol::testFork_DeriveKnownSandwich` must agree on bit-for-bit.
 *
 * Derivation (see ForkDerive.t.sol for the actual replay):
 *   1. Fork mainnet at block 22450092 (== KNOWN_SANDWICH.block - 1, i.e.
 *      state right before block 22450093 executes — before A, V, or B).
 *   2. Impersonate the victim and replay their EXACT transaction calldata
 *      (to the same router, same value, same input bytes) against that
 *      pre-front-run state.
 *   3. Read the RATO amount the pool's Swap log reports going out to the
 *      router in that replay: that is `simOut` — what the victim would
 *      have received had nobody front-run them.
 *   4. `realOut` is what the victim actually received in the real block
 *      (KNOWN_SANDWICH.victim.amountOutRaw above, decoded straight from the
 *      real block's Swap log — the two are asserted equal in
 *      sandwich-fixture.test.ts).
 *   5. `extractedWei = simOut - realOut` (computeExtracted, floored at
 *      zero) — units are raw RATO (the victim's output token), not ETH.
 *      This is deliberately NOT the same figure as the "best-effort gross
 *      round-trip ETH" number in substreams/fixtures/known-sandwich.md —
 *      that one is `B.amountOutWei - A.amountInWei` in the *round-tripped*
 *      token (ETH), a rough proxy computed purely from swap amounts; this
 *      one is the ledger's actual `simOut - realOut` definition, computed
 *      against real pre/post front-run chain state, in the victim's output
 *      token (RATO). Both are legitimate; they measure different things and
 *      are intentionally not equal.
 */
export const KNOWN_SANDWICH_DERIVED = {
  simOut: 170271606146665190n,
  realOut: 157358171477322859n,
  extractedWei: 12913434669342331n,
} as const

/**
 * Negative control: the block immediately after KNOWN_SANDWICH.block, same
 * pool, where the pool emits zero logs at all (no Swap/Mint/Burn/Sync) — see
 * substreams/fixtures/known-clean.md.
 */
export const KNOWN_CLEAN_BLOCK = {
  chain: 'ethereum-mainnet',
  block: 22450094,
  pool: '0x8D02988296949cd054623802c1115973A9AFE307' as Address,
} as const
