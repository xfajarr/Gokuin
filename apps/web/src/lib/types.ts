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
  /** The transaction's `from` — the EOA that signed it. This is what identifies
   * the attacker, deliberately NOT a Swap event's `sender` field: in Uniswap,
   * `sender` is populated by the router contract and is identical for the
   * attacker's transactions and the victim's, since both went through the same
   * router. See the trap note on /probe/$id. */
  from: `0x${string}`
  /** Trade direction inferred from the pool's token ordering, when the API
   * reports it. Optional and honestly absent rather than guessed: older rows
   * or a leaner API response may not carry it, and the sandwich checklist
   * says so explicitly instead of assuming a direction it cannot verify. */
  direction?: 'buy' | 'sell'
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

/** POST /admin/cycles/run body — mirrors apps/api/src/routes/admin.ts's t.Object. */
export interface CycleRunInput {
  cycleId: number
  pool: `0x${string}`
  router: `0x${string}`
  amountInWei: string
  slippageBps: number
}

/** POST /admin/cycles/run response — mirrors RunCycleResult in apps/api/src/cycle/run.ts.
 * Step 4-7 (inclusion, observation, simulate, sandwich) are NOT necessarily
 * finished by the time this responds — run() only settles whatever has
 * already reached 'included' status (see that file's own comment). The
 * console polls GET /v1/probes/:id afterwards to reveal the rest as it lands. */
export interface CycleRunResult {
  cycleId: number
  scheduleHash: `0x${string}`
  committedTx: `0x${string}`
  probeIds: number[]
  reveal: {
    cycleId: number
    committed: number
    published: number
    intact: boolean
    tx: `0x${string}`
  }
}
