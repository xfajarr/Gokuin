import { createFileRoute } from '@tanstack/react-router'
import { getIntegrity } from '../lib/api'
import { formatTimestamp } from '../lib/format'
import { TxHashLink } from '../components/Hash'
import { IntegrityBadge } from '../components/Badge'

export const Route = createFileRoute('/cycle/$id')({
  loader: ({ params }) => getIntegrity({ data: params.id }),
  component: CycleDetail,
})

function CycleDetail() {
  const { data, sample } = Route.useLoaderData()
  const { id } = Route.useParams()
  const gap = data.committed - data.published

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Commit / reveal</div>
        <h1>Cycle #{id}</h1>
        <p>
          The schedule for this cycle was hashed and committed on Sepolia before any probe dispatched. Reveal
          publishes the salt; the published count must equal the committed count or the gap is visible forever.
        </p>
      </div>

      {sample && (
        <div className="sample-banner">
          SAMPLE DATA — the Gokuin API at API_URL did not respond for cycle {id}. Fixture integrity shown below.
        </div>
      )}

      <dl className="legend">
        <div>
          <dt>Commit</dt>
          <dd>the schedule's hash, posted on Sepolia before any probe was dispatched</dd>
        </div>
        <div>
          <dt>Reveal</dt>
          <dd>the salt, published once the cycle settles</dd>
        </div>
        <div>
          <dt>Intact</dt>
          <dd>committed count equals published count — no probe was quietly dropped or added after the fact</dd>
        </div>
      </dl>

      <div className="integrity">
        <span>committed</span>
        <span className="num">{data.committed}</span>
        <span className="integrity-sep">·</span>
        <span>published</span>
        <span className="num">{data.published}</span>
        <span className="integrity-sep">·</span>
        <IntegrityBadge intact={data.intact} />
      </div>

      {gap !== 0 && (
        <div className="sample-banner" style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}>
          Gap of {Math.abs(gap)} between committed and published rows. This is exactly the discrepancy commit-reveal
          exists to surface — it is on-chain and permanent.
        </div>
      )}

      <div className="grid-cards">
        <div className="stat">
          <div className="stat-label">Schedule hash</div>
          <div className="stat-value num" style={{ fontSize: '0.95rem' }}>
            {data.scheduleHash ? `${data.scheduleHash.slice(0, 18)}…` : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Committed at</div>
          <div className="stat-value num" style={{ fontSize: '1rem' }}>
            {formatTimestamp(data.committedAt)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Revealed at</div>
          <div className="stat-value num" style={{ fontSize: '1rem' }}>
            {formatTimestamp(data.revealedAt)}
          </div>
        </div>
      </div>

      <h2 className="section-title">On-chain evidence</h2>
      <dl className="kv">
        <dt>commit tx (Sepolia)</dt>
        <dd>{data.committedTx ? <TxHashLink hash={data.committedTx} network="sepolia" /> : 'pending'}</dd>
        <dt>reveal tx (Sepolia)</dt>
        <dd>{data.revealedTx ? <TxHashLink hash={data.revealedTx} network="sepolia" /> : 'pending'}</dd>
      </dl>

      <h2 className="section-title">Why this is checkable</h2>
      <p>
        The commit transaction fixes <code>schedule_hash</code> before dispatch. Nobody — including Gokuin — can
        change which slots ran which route after the fact without the hash failing to match. Reveal then publishes
        the salt, and anyone can recompute <code>hashSchedule()</code> from <code>@gokuin/core</code> and check it
        against the commit. A committed count that doesn&rsquo;t match the published row count is cherry-picking or
        omission, and it would sit on-chain forever.
      </p>
    </main>
  )
}
