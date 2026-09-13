import { createFileRoute, notFound } from '@tanstack/react-router'
import { ROUTES, delayBlocks } from '@gokuin/core'
import { getRoute, getRouteRows } from '../lib/api'
import { bpsToPct, weiToEth } from '../lib/format'
import { ROUTE_LABELS } from '../lib/types'
import { TxHashLink } from '../components/Hash'
import { NoDataBadge, StagedBadge, VerdictBadge } from '../components/Badge'

export const Route = createFileRoute('/route/$id')({
  loader: async ({ params }) => {
    if (!(ROUTES as readonly string[]).includes(params.id)) throw notFound()
    const [route, rows] = await Promise.all([
      getRoute({ data: params.id }),
      getRouteRows({ data: { id: params.id } }),
    ])
    return { route, rows }
  },
  component: RouteDetail,
})

function RouteDetail() {
  const { route, rows } = Route.useLoaderData()
  const score = route.data
  const sample = route.sample || rows.sample
  const hasData = score.probes > 0

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Route record</div>
        <h1>{ROUTE_LABELS[score.route] ?? score.route}</h1>
        <p>
          {hasData
            ? `${score.probes} non-staged probes measured through cycle ${score.lastCycle}.`
            : 'No non-staged probes have been measured on this route yet.'}{' '}
          Every row below is one twin probe&rsquo;s evidence, the mainnet tx hash links to the public explorer, no
          number here is asserted without it.
        </p>
      </div>

      {sample && (
        <div className="sample-banner">
          SAMPLE DATA, the Gokuin API at API_URL did not respond for this route. Fixture numbers below.
        </div>
      )}

      {!hasData && (
        <div className="note-banner">
          <NoDataBadge /> This route has {score.stagedExcluded > 0 ? 'only staged rows' : 'no rows'} on record.{' '}
          {score.stagedExcluded > 0
            ? `${score.stagedExcluded} row(s) were excluded because we caused them ourselves (see below): they cannot count as evidence about this route.`
            : 'It has not been probed yet this cycle.'}{' '}
          This reads as no data, not as a clean 0%: a route scored on nothing but staged rows must never look like a
          passing record.
        </div>
      )}

      {hasData && (
        <div className="grid-cards">
          <div className="stat" id="leaks">
            <div className="stat-label">Leaked</div>
            <div className="stat-value num">
              {score.leaks} / {score.probes}
            </div>
            <div className="muted small">{bpsToPct(score.leakBps)}</div>
          </div>
          <div className="stat" id="sandwiches">
            <div className="stat-label">Sandwiched</div>
            <div className="stat-value num">
              {score.sandwiches} / {score.probes}
            </div>
            <div className="muted small">{bpsToPct(score.sandwichBps)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Median inclusion</div>
            <div className="stat-value num">{score.medianDelayBlocks} blk</div>
          </div>
          <div className="stat" id="extracted">
            <div className="stat-label">ETH extracted</div>
            <div className="stat-value num accent">{weiToEth(score.totalExtractedWei)}</div>
          </div>
        </div>
      )}

      {score.stagedExcluded > 0 && hasData && (
        <p className="small muted">
          {score.stagedExcluded} additional row(s) on this route were staged by us and are excluded from every figure
          above, see the marked row(s) below.
        </p>
      )}

      <h2 className="section-title">Evidence rows, cycle {score.lastCycle}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mainnet tx</th>
              <th className="num">Submitted</th>
              <th className="num">Included</th>
              <th className="num">Delay</th>
              <th>Leaked</th>
              <th>Sandwiched</th>
              <th className="num">Extracted</th>
              <th className="num">Cycle</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.rows.map((row) => (
              <tr key={row.mainnetTxHash} className={row.staged ? 'row-staged' : ''}>
                <td>
                  <TxHashLink hash={row.mainnetTxHash} />
                </td>
                <td className="num">{row.submittedBlock}</td>
                <td className="num">{row.includedBlock}</td>
                <td className="num">{delayBlocks(row.submittedBlock, row.includedBlock)}</td>
                <td>
                  <VerdictBadge bad={row.leakedAtBlock > 0} badLabel="leaked" goodLabel="clean" />
                </td>
                <td>
                  <VerdictBadge bad={row.sandwiched} badLabel="sandwiched" goodLabel="kept" />
                </td>
                <td className="num">{weiToEth(row.extractedWei)} ETH</td>
                <td className="num">{row.cycleId}</td>
                <td>{row.staged ? <StagedBadge /> : <span className="muted small">route traffic</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.data.cursor && <p className="small muted">More rows exist past this page (cursor {rows.data.cursor}).</p>}
      {rows.data.rows.some((r) => r.staged) && (
        <p className="small muted">
          Rows marked <StagedBadge /> are sandwiches we executed ourselves against our own probe, to prove the
          detector works. They are evidence about the detector, never about this route, and{' '}
          <code>scoreRoute()</code> excludes them from every ratio and total above.
        </p>
      )}
    </main>
  )
}
