// Shared vocabulary. Imported by contracts tooling, api, listener, web, mcp.
// One definition, every consumer. If these drift, the project has no product.

export const ROUTES = ['public-mempool', 'flashbots-protect', 'mev-blocker'] as const
export type RouteId = (typeof ROUTES)[number]

/** routeId used on-chain, index into ROUTES, stable forever. Never reorder. */
export const ROUTE_IDS: Record<RouteId, number> = {
  'public-mempool': 0,
  'flashbots-protect': 1,
  'mev-blocker': 2,
}

export const REGIONS = ['eu-central', 'us-east'] as const
export type Region = (typeof REGIONS)[number]

export type Need = 'privacy' | 'speed' | 'inclusion' | 'cheap'

/** Whether a metric can be re-derived by anyone, or rests on our observation. */
export type Provenance = 'public' | 'attested'

export interface Observation {
  txHash: `0x${string}`
  region: Region
  firstSeen: number      // unix ms
  seenBlock: number      // chain head at observation
  fromUncle: boolean     // uncle re-broadcast, logged, excluded from leak
  signature: `0x${string}`
}

export interface Probe {
  id: number
  cycleId: number
  route: RouteId
  twinGroup: string
  fromAddress: `0x${string}`
  txHash?: `0x${string}`
  pool: `0x${string}`
  amountInWei: string
  slippageBps: number
  submittedBlock?: number
  includedBlock?: number
  status: 'pending' | 'included' | 'dropped' | 'reverted'
}

/** One row of evidence. Mirrors ProbeLedger.Row exactly. */
export interface Row {
  mainnetTxHash: `0x${string}`
  submittedBlock: number
  includedBlock: number
  leakedAtBlock: number      // 0 = not leaked
  extractedWei: bigint
  simOut: bigint
  realOut: bigint
  routeId: number
  cycleId: number
  sandwiched: boolean
  /**
   * True when we caused this outcome ourselves, a sandwich executed against our
   * own probe to demonstrate the detection path, because a real one cannot be
   * scheduled for a recording.
   *
   * A staged row is evidence about the DETECTOR, never about the ROUTE, and
   * scoreRoute() excludes it from every ratio and total. Counting it would put
   * manufactured data into a number we ask other people to trust.
   */
  staged: boolean
}

export interface RouteScore {
  route: RouteId
  probes: number
  leaks: number
  leakBps: number
  sandwiches: number
  sandwichBps: number
  medianDelayBlocks: number
  totalExtractedWei: string
  lastCycle: number
  /** How many rows were withheld from the figures above because we staged them.
   *  Surfaced rather than silent: a reader should see that an exclusion happened. */
  stagedExcluded: number
}

export interface Selection {
  route: RouteId
  reason: string
  evidence: { txHash: string; what: string }[]
  runnerUp: RouteId | null
}
