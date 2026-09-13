// Reads scores from the SUBGRAPH via GraphQL, never from SQLite. This is
// load-bearing (PRD §5, §12): if the subgraph is unavailable there are no
// scores. SQLite only holds probe metadata (db.ts).
import type { RouteId, RouteScore } from '@gokuin/core'
import type { Env } from '../env'

export class ScoreReadUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoreReadUnavailable'
  }
}

const ROUTE_FIELDS = `id probes leaks sandwiches totalExtractedWei medianDelayBlocks`

// Same rounding as the internal bps() helper inside scoreRoute() in
// packages/core/src/metrics.ts. Duplicated only because the subgraph's Route
// entity (PRD §5) stores raw counts, not bps — this is presentation
// arithmetic on numbers the subgraph already computed, not a redefinition of
// what counts as a leak, a sandwich, or extracted value.
function bps(n: number, total: number): number {
  return total ? Math.round((n / total) * 10_000) : 0
}

function toRouteScore(r: {
  id: string
  probes: string | number
  leaks: string | number
  sandwiches: string | number
  totalExtractedWei: string
  medianDelayBlocks: string | number
  lastCycle?: string | number
  stagedExcluded?: string | number
}): RouteScore {
  const probes = Number(r.probes)
  const leaks = Number(r.leaks)
  const sandwiches = Number(r.sandwiches)
  return {
    route: r.id as RouteId,
    stagedExcluded: Number(r.stagedExcluded ?? 0),
    probes,
    leaks,
    leakBps: bps(leaks, probes),
    sandwiches,
    sandwichBps: bps(sandwiches, probes),
    medianDelayBlocks: Number(r.medianDelayBlocks),
    totalExtractedWei: String(r.totalExtractedWei),
    lastCycle: Number(r.lastCycle ?? 0),
  }
}

export interface RowsPage {
  rows: {
    id: string
    mainnetTxHash: string
    includedBlock: string
    leaked: boolean
    sandwiched: boolean
    extractedWei: string
    cycleId: number
  }[]
  nextCursor?: string
}

export function createScoreReader(env: Env) {
  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (!env.SUBGRAPH_URL) {
      throw new ScoreReadUnavailable('SUBGRAPH_URL not configured — no Graph, no scores (PRD §5, §12).')
    }
    const res = await fetch(env.SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new ScoreReadUnavailable(`subgraph responded ${res.status}`)
    const json = (await res.json()) as { data?: T; errors?: unknown }
    if (json.errors) throw new ScoreReadUnavailable(`subgraph error: ${JSON.stringify(json.errors)}`)
    if (!json.data) throw new ScoreReadUnavailable('subgraph returned no data')
    return json.data
  }

  return {
    async allRoutes(): Promise<RouteScore[]> {
      const data = await gql<{ routes: any[] }>(`{ routes(first: 100) { ${ROUTE_FIELDS} } }`)
      return data.routes.map(toRouteScore)
    },

    async route(id: string): Promise<RouteScore | null> {
      const data = await gql<{ route: any | null }>(
        `query($id: ID!) { route(id: $id) { ${ROUTE_FIELDS} } }`,
        { id },
      )
      return data.route ? toRouteScore(data.route) : null
    },

    async rows(id: string, opts: { limit: number; cursor?: string }): Promise<RowsPage> {
      const data = await gql<{ rows: any[] }>(
        `query($route: String!, $first: Int!, $cursor: String!) {
           rows(first: $first, orderBy: id, where: { route: $route, id_gt: $cursor }) {
             id mainnetTxHash includedBlock leaked sandwiched extractedWei cycleId
           }
         }`,
        { route: id, first: opts.limit, cursor: opts.cursor ?? '' },
      )
      const nextCursor = data.rows.length === opts.limit ? data.rows[data.rows.length - 1].id : undefined
      return { rows: data.rows, nextCursor }
    },
  }
}

export type ScoreReader = ReturnType<typeof createScoreReader>
