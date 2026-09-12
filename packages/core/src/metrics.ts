// THE measurement definitions. docs/metrics.md is generated from these comments.
// contracts/test/ForkDerive.t.sol must agree with computeExtracted() on the same fixture.

import type { Observation, Row, RouteScore, RouteId } from './types'

export const MIN_LISTENER_AGREEMENT = 2

/**
 * leaked — the treatment tx hash was observed in the PUBLIC mempool by at least
 * MIN_LISTENER_AGREEMENT independent signed listeners, at a block height STRICTLY
 * BELOW its inclusion block. Uncle re-broadcasts are excluded (logged separately).
 */
export function isLeaked(obs: Observation[], includedBlock: number) {
  const valid = obs.filter(o => !o.fromUncle && o.seenBlock < includedBlock)
  const regions = new Set(valid.map(o => o.region))
  return {
    leaked: regions.size >= MIN_LISTENER_AGREEMENT,
    leakedAtBlock: valid.length ? Math.min(...valid.map(o => o.seenBlock)) : 0,
    agreeingRegions: [...regions],
  }
}

/**
 * extractedWei — simOut minus realOut, where simOut is an eth_call of the IDENTICAL
 * calldata against state at (includedBlock - 1). Never negative.
 */
export function computeExtracted(simOut: bigint, realOut: bigint): bigint {
  const d = simOut - realOut
  return d > 0n ? d : 0n
}

/** delayBlocks — includedBlock minus the chain head at the moment of dispatch. */
export function delayBlocks(submittedBlock: number, includedBlock: number) {
  return Math.max(0, includedBlock - submittedBlock)
}

/**
 * sandwiched — A before ours and B after, SAME block, SAME pool, OPPOSITE directions,
 * distinct hashes, A.from == B.from. Detected by the Substreams module; this type
 * only records the module's verdict plus the hashes that prove it.
 */
export interface SandwichVerdict {
  sandwiched: boolean
  frontrunHash?: `0x${string}`
  backrunHash?: `0x${string}`
  attacker?: `0x${string}`
  moduleVersion: string
}

export function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export function scoreRoute(route: RouteId, rows: Row[]): RouteScore {
  const probes = rows.length
  const leaks = rows.filter(r => r.leakedAtBlock > 0).length
  const sandwiches = rows.filter(r => r.sandwiched).length
  const bps = (n: number) => (probes ? Math.round((n / probes) * 10_000) : 0)
  return {
    route,
    probes,
    leaks,
    leakBps: bps(leaks),
    sandwiches,
    sandwichBps: bps(sandwiches),
    medianDelayBlocks: median(rows.map(r => delayBlocks(r.submittedBlock, r.includedBlock))),
    totalExtractedWei: rows.reduce((a, r) => a + r.extractedWei, 0n).toString(),
    lastCycle: rows.reduce((a, r) => Math.max(a, r.cycleId), 0),
  }
}

/** Which metrics anyone can re-derive, and which rest on our observation. */
export const PROVENANCE = {
  sandwiched: 'public',
  extractedWei: 'public',
  delayBlocks: 'public',
  reverted: 'public',
  rebate: 'public',
  leaked: 'attested',   // the only one
} as const
