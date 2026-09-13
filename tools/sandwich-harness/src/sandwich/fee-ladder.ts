// Gas priority laddering, the ordering mechanism this harness actually
// uses, and the thing README.md reports on for reliability. Sepolia has no
// Flashbots-style bundle relay, so there is no way to guarantee atomic
// same-block, fixed-order inclusion the way mainnet MEV-Boost bundles do.
// Instead: give the front-run the highest tip, the victim a medium tip, and
// the back-run the lowest (but still comfortably-included) tip, and submit
// all three within milliseconds of each other. Public-mempool block
// builders order transactions from distinct senders by effective tip,
// highest first, which is the ordering A < V < B needs.
//
// This is a heuristic, not a guarantee: see README.md for the measured
// success rate across repeated attempts and what "not landing as ordered"
// looks like when it happens.
export type Leg = 'frontrun' | 'victim' | 'backrun'

export interface FeeParams {
  maxPriorityFeePerGas: bigint
  maxFeePerGas: bigint
}

export const PRIORITY_GWEI: Record<Leg, bigint> = {
  frontrun: 6_000_000_000n, // 6 gwei tip, must land first
  victim: 3_000_000_000n, // 3 gwei tip, the "unsuspecting" probe, still healthy priority
  backrun: 1_500_000_000n, // 1.5 gwei tip, must land last, but still within the same block
}

/**
 * Builds the three legs' fee params off one shared base-fee reading, so a
 * single up-to-date `baseFeePerGas` (from the pending block) drives all
 * three instead of three independent, possibly-stale estimates.
 */
export function buildFeeLadder(baseFeePerGas: bigint): Record<Leg, FeeParams> {
  const headroom = baseFeePerGas * 4n // generous ceiling so a base-fee jump between build and inclusion cannot strand a leg
  const out = {} as Record<Leg, FeeParams>
  for (const leg of Object.keys(PRIORITY_GWEI) as Leg[]) {
    out[leg] = { maxPriorityFeePerGas: PRIORITY_GWEI[leg], maxFeePerGas: headroom + PRIORITY_GWEI[leg] }
  }
  return out
}

/** Order legs must appear in within the target block, for reporting/verification. */
export const REQUIRED_ORDER: readonly Leg[] = ['frontrun', 'victim', 'backrun']
