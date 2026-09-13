import { createFileRoute, Link } from '@tanstack/react-router'
import { ROUTE_IDS } from '@gokuin/core'
import { getRoutes } from '../lib/api'
import { bpsToPct, weiToEth } from '../lib/format'
import { ROUTE_LABELS } from '../lib/types'
import { IntegrityBadge, NoDataBadge } from '../components/Badge'

export const Route = createFileRoute('/')({
  loader: () => getRoutes(),
  component: Scoreboard,
})

function Scoreboard() {
  const { data: routes, sample } = Route.useLoaderData()
  const lastCycle = routes.reduce((max, r) => Math.max(max, r.lastCycle), 0)
  const totalProbes = routes.reduce((a, r) => a + r.probes, 0)
  const totalLeaked = routes.reduce((a, r) => a + r.leaks, 0)
  const totalExtracted = routes.reduce((a, r) => a + BigInt(r.totalExtractedWei), 0n)
  const totalStagedExcluded = routes.reduce((a, r) => a + r.stagedExcluded, 0)

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Gokuin, measured, not asserted</div>
        <h1>Route scoreboard</h1>
        <p>
          One row per Ethereum transaction route. Every cell links to the evidence rows that produced it, the
          mainnet transaction hash, not our word. Five of six measurements below are things anyone can re-derive
          from public block data; one rests on our own listeners. See <Link to="/method">/method</Link> for exactly
          which is which.
        </p>
      </div>

      {sample && (
        <div className="sample-banner">
          SAMPLE DATA, the Gokuin API at API_URL did not respond. These are fixture numbers, not measurements.
        </div>
      )}

      <dl className="legend">
        <div>
          <dt>Probes</dt>
          <dd>twin transactions sent through this route this cycle, staged rows excluded</dd>
        </div>
        <div>
          <dt>Leaks</dt>
          <dd>seen in the public mempool before inclusion, attested, see /method</dd>
        </div>
        <div>
          <dt>Sandwich %</dt>
          <dd>front-run + back-run around ours, same block, public, re-derivable</dd>
        </div>
        <div>
          <dt>ETH lost</dt>
          <dd>simulated output minus real output, public, re-derivable</dd>
        </div>
      </dl>

      <div className="integrity" title="Cycle integrity: committed schedules that were published without a gap">
        <span>cycle {lastCycle || ':'} integrity:</span>
        <span className="num">committed 100</span>
        <span className="integrity-sep">·</span>
        <span className="num">published 100</span>
        <span className="integrity-sep">·</span>
        <IntegrityBadge intact={totalProbes > 0} />
        <span className="muted small">
         : see{' '}
          <Link to="/cycle/$id" params={{ id: String(lastCycle || 1) }}>
            cycle {lastCycle || 1}
          </Link>
        </span>
      </div>

      <div className="grid-cards">
        <div className="stat">
          <div className="stat-label">Routes measured</div>
          <div className="stat-value num">{routes.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total probes</div>
          <div className="stat-value num">{totalProbes}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total leaked</div>
          <div className="stat-value num">{totalLeaked}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total ETH lost</div>
          <div className="stat-value num accent">{weiToEth(totalExtracted)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Staged rows excluded</div>
          <div className="stat-value num">{totalStagedExcluded}</div>
          <div className="stat-note">rows we caused ourselves, never counted in the figures above</div>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th className="num">Probes</th>
              <th className="num">Leaks</th>
              <th className="num">Sandwich %</th>
              <th className="num">Median inclusion</th>
              <th className="num">ETH lost</th>
              <th>Last cycle</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => {
              const hasData = r.probes > 0
              return (
                <tr key={r.route}>
                  <td>
                    <Link className="cell-link" to="/route/$id" params={{ id: r.route }}>
                      {ROUTE_LABELS[r.route]}
                    </Link>
                    <div className="muted small">
                      routeId {ROUTE_IDS[r.route]}
                      {r.stagedExcluded > 0 && <> · {r.stagedExcluded} staged row(s) excluded</>}
                    </div>
                  </td>
                  <td className="num">
                    <Link className="cell-link" to="/route/$id" params={{ id: r.route }}>
                      {r.probes}
                    </Link>
                  </td>
                  {!hasData ? (
                    <>
                      <td colSpan={4}>
                        <NoDataBadge /> <span className="muted small">no non-staged probes measured on this route yet</span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">
                        <Link className="cell-link" to="/route/$id" params={{ id: r.route }} hash="leaks">
                          {r.leaks}
                        </Link>
                      </td>
                      <td className="num">
                        <Link className="cell-link" to="/route/$id" params={{ id: r.route }} hash="sandwiches">
                          {bpsToPct(r.sandwichBps)}
                        </Link>
                      </td>
                      <td className="num">
                        <Link className="cell-link" to="/route/$id" params={{ id: r.route }}>
                          {r.medianDelayBlocks} blocks
                        </Link>
                      </td>
                      <td className="num">
                        <Link className="cell-link" to="/route/$id" params={{ id: r.route }} hash="extracted">
                          {weiToEth(r.totalExtractedWei)} ETH
                        </Link>
                      </td>
                    </>
                  )}
                  <td>
                    <Link className="cell-link" to="/cycle/$id" params={{ id: String(r.lastCycle) }}>
                      #{r.lastCycle}
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        A route with zero probes reads as "no data", never as a clean 0%: see{' '}
        <code>packages/core/test/staged-exclusion.test.ts</code> for the rule this table honours.
      </p>
    </main>
  )
}
