// GET endpoints for web + mcp (PRD §7.1, §7.2). Scores come from the
// Subgraph (ctx.scoreReader); probe/cycle detail comes from SQLite metadata.
import { Elysia, t } from 'elysia'
import { ScoreReadUnavailable } from '../score/read'
import type { AppContext } from '../context'
import { RouteScore, Selection } from './schemas'

interface ProbeRow {
  id: number
  cycle_id: number
  route: string
  twin_group: string
  from_address: string
  tx_hash: string | null
  pool: string
  amount_in_wei: string
  slippage_bps: number
  submitted_block: number | null
  submitted_at: number | null
  included_block: number | null
  status: string
}

interface DerivationRow {
  probe_id: number
  sim_out: string
  real_out: string
  extracted_wei: string
  sandwiched: number
  frontrun_hash: string | null
  backrun_hash: string | null
  leaked: number
  leaked_at: number | null
  module_version: string
  ledger_tx: string | null
}

function probeDetail(ctx: AppContext, id: number) {
  const probe = ctx.stmts.getProbe.get(id) as ProbeRow | null
  if (!probe) return null
  const twin = (ctx.stmts.getProbesByTwinGroup.all(probe.twin_group) as ProbeRow[]).filter(p => p.id !== probe.id)
  const observations = ctx.stmts.getObservationsByProbe.all(id)
  const derivation = ctx.stmts.getDerivation.get(id) as DerivationRow | null
  return { probe, twin, observations, derivation }
}

interface FundingAccountingRow {
  amount_wei: string
  swept_amount_wei: string | null
  dust_skipped: number
}

/**
 * Per-cycle funding total (this task's requirement 4): the real cost of a
 * measurement should be visible, not hidden. `netCostWei` = funded - swept
 * (dust left in place counts against the cycle's cost, on purpose — a
 * skipped sweep is still capital that did not come back).
 */
function cycleFundingTotals(ctx: AppContext, cycleId: number) {
  const rows = ctx.stmts.getFundingByCycle.all(cycleId) as FundingAccountingRow[]
  let fundedWei = 0n
  let sweptWei = 0n
  let dustSkippedCount = 0
  for (const row of rows) {
    fundedWei += BigInt(row.amount_wei)
    if (row.swept_amount_wei) sweptWei += BigInt(row.swept_amount_wei)
    if (row.dust_skipped) dustSkippedCount += 1
  }
  return {
    probesFunded: rows.length,
    totalFundedWei: fundedWei.toString(),
    totalSweptWei: sweptWei.toString(),
    netCostWei: (fundedWei - sweptWei).toString(),
    dustSkippedCount,
  }
}

async function cycleIntegrity(ctx: AppContext, id: number) {
  const funding = cycleFundingTotals(ctx, id)

  // Prefer the contract's own view function — it is the on-chain source of
  // truth (PRD §6.1 integrity()). Fall back to the local SQLite tally when no
  // ledger address is configured (dry-run / no deployment yet).
  const onChain = await ctx.ledger.integrity(id)
  if (onChain) return { ...onChain, source: 'ledger' as const, funding }

  const cycle = ctx.stmts.getCycle.get(id) as { probe_count: number } | null
  if (!cycle) return null
  const probes = ctx.stmts.getProbesByCycle.all(id) as { status: string }[]
  const published = probes.filter(p => p.status === 'included' || p.status === 'reverted').length
  return {
    committed: cycle.probe_count,
    published,
    intact: published === cycle.probe_count,
    source: 'sqlite-dry-run' as const,
    funding,
  }
}

export function createPublicRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/v1' })
    .onError(({ error, set }) => {
      if (error instanceof ScoreReadUnavailable) {
        set.status = 503
        return { error: error.message }
      }
    })
    .get('/routes', () => ctx.scoreReader.allRoutes(), {
      response: t.Array(RouteScore),
    })
    .get(
      '/routes/:id',
      async ({ params, set }) => {
        const route = await ctx.scoreReader.route(params.id)
        if (!route) {
          set.status = 404
          return { error: 'unknown route' }
        }
        return route
      },
      { params: t.Object({ id: t.String() }) },
    )
    .get(
      '/routes/:id/rows',
      ({ params, query }) => ctx.scoreReader.rows(params.id, query),
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({ limit: t.Numeric({ default: 50 }), cursor: t.Optional(t.String()) }),
      },
    )
    .get(
      '/probes/:id',
      ({ params, set }) => {
        const detail = probeDetail(ctx, Number(params.id))
        if (!detail) {
          set.status = 404
          return { error: 'unknown probe' }
        }
        return detail
      },
      { params: t.Object({ id: t.String() }) },
    )
    .get(
      '/cycles/:id/integrity',
      async ({ params, set }) => {
        const result = await cycleIntegrity(ctx, Number(params.id))
        if (!result) {
          set.status = 404
          return { error: 'unknown cycle' }
        }
        return result
      },
      { params: t.Object({ id: t.String() }) },
    )
    .post(
      '/select',
      ({ body }) => ctx.selector.pick(body),
      {
        body: t.Object({
          need: t.Union([t.Literal('privacy'), t.Literal('speed'), t.Literal('inclusion'), t.Literal('cheap')]),
          maxLeakBps: t.Optional(t.Number()),
          maxWaitBlocks: t.Optional(t.Number()),
        }),
        response: Selection,
      },
    )
    .get('/watchlist', () => {
      const rows = ctx.stmts.getPendingProbeTxHashes.all() as { tx_hash: string }[]
      return { txHashes: rows.map(r => r.tx_hash) }
    })
}
