// Local shapes for API responses that COMPOSE @gokuin/core types but aren't
// themselves defined there (probe detail, cycle integrity). Never redefine
// anything that already lives in @gokuin/core — Probe, Observation, RouteScore,
// Row, Selection, RouteId, Region, Need, Provenance all come from there.
import type { Observation, Probe, RouteId } from '@gokuin/core'

/** GET /v1/cycles/:id/integrity */
export interface Integrity {
  cycleId: number
  committed: number
  published: number
  intact: boolean
  scheduleHash?: `0x${string}`
  committedTx?: `0x${string}`
  revealedTx?: `0x${string}`
  committedAt?: number
  revealedAt?: number
}

export type BlockRole = 'frontrun' | 'victim' | 'backrun'

export interface BlockTx {
  hash: `0x${string}`
  position: number
  role: BlockRole
  from: `0x${string}`
}

/** One value per metric named in PROVENANCE, keyed the same way, so the
 * derivation table can be driven entirely off core's PROVENANCE map. */
export interface DerivationValues {
  sandwiched: boolean
  extractedWei: string
  delayBlocks: number
  reverted: boolean
  rebate: string | null
  leaked: boolean
}

export interface Derivation extends DerivationValues {
  simOut: string
  realOut: string
  leakedAtBlock: number
  frontrunHash: `0x${string}` | null
  backrunHash: `0x${string}` | null
  moduleVersion: string
  ledgerTx: `0x${string}` | null
  agreeingRegions: string[]
}

/** GET /v1/probes/:id — assumed shape: the treatment probe, its twin (same
 * twinGroup, different route, otherwise identical params), the raw listener
 * observations, a 3-tx block window, and the derivation record. */
export interface ProbeDetail {
  probe: Probe
  twin: Probe
  observations: Observation[]
  block: {
    number: number
    pool: `0x${string}`
    transactions: BlockTx[]
  } | null
  derivation: Derivation
}

export interface RouteRowsResponse {
  rows: import('@gokuin/core').Row[]
  cursor?: string
}

/** Wrapper every api.ts server function resolves to — `sample: true` means
 * the live API was unreachable and `data` is the fixture fallback. */
export interface Fetched<T> {
  data: T
  sample: boolean
  error?: string
}

export const ROUTE_LABELS: Record<RouteId, string> = {
  'public-mempool': 'Public mempool',
  'flashbots-protect': 'Flashbots Protect',
  'mev-blocker': 'MEV Blocker',
}
