import { createFileRoute, notFound } from '@tanstack/react-router'
import { ROUTES, delayBlocks } from '@gokuin/core'
import { getRoute, getRouteRows } from '../lib/api'
import { bpsToPct, weiToEth } from '../lib/format'
import { ROUTE_LABELS } from '../lib/types'
import { TxHashLink } from '../components/Hash'
import { VerdictBadge } from '../components/Badge'

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

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Route record</div>
        <h1>{ROUTE_LABELS[score.route] ?? score.route}</h1>
        <p>
          {score.probes} probes measured through cycle {score.lastCycle}. Every row below is one twin probe's
          evidence — the mainnet tx hash links to the public explorer, no number here is asserted without it.
        </p>
      </div>

      {sample && (
        <div className="sample-banner">
          SAMPLE DATA — the Gokuin API at API_URL did not respond for this route. Fixture numbers below.
        </div>
      )}

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

      <h2 className="section-title">Evidence rows — cycle {score.lastCycle}</h2>
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
            </tr>
          </thead>
          <tbody>
            {rows.data.rows.map((row) => (
              <tr key={row.mainnetTxHash}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.data.cursor && <p className="small muted">More rows exist past this page (cursor {rows.data.cursor}).</p>}
    </main>
  )
}
