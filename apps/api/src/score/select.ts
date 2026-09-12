// The routing decision behind POST /v1/select — PRD §7.2: "the single most
// important endpoint... An agent must be able to explain its choice." Ranks
// routes purely off subgraph-sourced RouteScore (score/read.ts), never off
// SQLite, and always returns real tx hashes as evidence.
import type { Need, RouteId, RouteScore, Selection } from '@gokuin/core'
import type { ScoreReader } from './read'
import { ScoreReadUnavailable } from './read'

function rankValue(need: Need, r: RouteScore): number {
  switch (need) {
    case 'privacy':
      return r.leakBps
    case 'speed':
      return r.medianDelayBlocks
    case 'inclusion':
      // proxy for "lands reliably and clean": leaks + sandwiches per probe
      return r.leakBps + r.sandwichBps
    case 'cheap':
      return r.probes ? Number(BigInt(r.totalExtractedWei) / BigInt(r.probes)) : 0
  }
}

function describeNeed(need: Need): string {
  switch (need) {
    case 'privacy':
      return 'leak rate'
    case 'speed':
      return 'median inclusion delay'
    case 'inclusion':
      return 'combined leak + sandwich rate'
    case 'cheap':
      return 'average value extracted per probe'
  }
}

function fmtRoute(id: RouteId): string {
  return id
}

function buildReason(need: Need, winner: RouteScore, runnerUp?: RouteScore): string {
  const metric = describeNeed(need)
  let headline: string
  switch (need) {
    case 'privacy':
      headline = `${fmtRoute(winner.route)} leaked ${winner.leaks} of ${winner.probes} probes (${(winner.leakBps / 100).toFixed(2)}%) and was sandwiched ${winner.sandwiches} times`
      break
    case 'speed':
      headline = `${fmtRoute(winner.route)} had a median inclusion delay of ${winner.medianDelayBlocks} block(s) across ${winner.probes} probes`
      break
    case 'inclusion':
      headline = `${fmtRoute(winner.route)} landed cleanly most often: ${winner.leaks} leaks and ${winner.sandwiches} sandwiches out of ${winner.probes} probes`
      break
    case 'cheap':
      headline = `${fmtRoute(winner.route)} extracted the least value on average across ${winner.probes} probes (${winner.totalExtractedWei} wei total)`
      break
  }
  const comparison = runnerUp
    ? ` — the runner-up, ${fmtRoute(runnerUp.route)}, scored worse on ${metric}.`
    : ' — it is the only route with a measured record for this cycle.'
  return `${headline}, the best measured ${metric} of the routes probed.${comparison}`
}

export interface SelectQuery {
  need: Need
  maxLeakBps?: number
  maxWaitBlocks?: number
}

export function createSelector(scoreReader: ScoreReader) {
  return {
    async pick(query: SelectQuery): Promise<Selection> {
      const routes = await scoreReader.allRoutes()
      if (!routes.length) {
        throw new ScoreReadUnavailable('subgraph has no scored routes yet — no cycles have settled')
      }

      const eligible = routes.filter(
        r =>
          (query.maxLeakBps === undefined || r.leakBps <= query.maxLeakBps) &&
          (query.maxWaitBlocks === undefined || r.medianDelayBlocks <= query.maxWaitBlocks),
      )
      const pool = eligible.length ? eligible : routes
      const sorted = [...pool].sort((a, b) => rankValue(query.need, a) - rankValue(query.need, b))
      const winner = sorted[0]
      const runnerUpScore = sorted[1]

      const evidencePage = await scoreReader.rows(winner.route, { limit: 3 })
      const evidence = evidencePage.rows.map(row => ({
        txHash: row.mainnetTxHash,
        what: row.leaked
          ? `leaked to the public mempool before inclusion at block ${row.includedBlock}`
          : row.sandwiched
            ? `sandwiched in block ${row.includedBlock}`
            : `included cleanly at block ${row.includedBlock}, no leak or sandwich`,
      }))

      return {
        route: winner.route,
        reason: buildReason(query.need, winner, runnerUpScore),
        evidence,
        runnerUp: runnerUpScore?.route ?? null,
      }
    },
  }
}

export type Selector = ReturnType<typeof createSelector>
