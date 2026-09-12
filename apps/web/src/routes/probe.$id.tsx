import { createFileRoute } from '@tanstack/react-router'
import { PROVENANCE, delayBlocks } from '@gokuin/core'
import { getProbe } from '../lib/api'
import { truncateAddress, weiToEth } from '../lib/format'
import { ROUTE_LABELS } from '../lib/types'
import { TxHashLink } from '../components/Hash'
import { ProvenanceBadge, VerdictBadge } from '../components/Badge'

export const Route = createFileRoute('/probe/$id')({
  loader: ({ params }) => getProbe({ data: params.id }),
  component: ProbeDemo,
})

const METRIC_LABEL: Record<keyof typeof PROVENANCE, string> = {
  sandwiched: 'sandwiched',
  extractedWei: 'extracted value',
  delayBlocks: 'inclusion delay',
  reverted: 'reverted',
  rebate: 'rebate',
  leaked: 'leaked',
}

function ProbeDemo() {
  const { data, sample } = Route.useLoaderData()
  const { id } = Route.useParams()
  const { probe, twin, block, derivation, observations } = data

  const metricValue: Record<keyof typeof PROVENANCE, string> = {
    sandwiched: derivation.sandwiched ? 'yes' : 'no',
    extractedWei: `${weiToEth(derivation.extractedWei)} ETH`,
    delayBlocks: `${derivation.delayBlocks} blocks`,
    reverted: derivation.reverted ? 'yes' : 'no',
    rebate: derivation.rebate ? `${weiToEth(derivation.rebate)} ETH` : 'n/a — not yet instrumented',
    leaked: derivation.leaked ? `leaked at block ${derivation.leakedAtBlock}` : 'not observed pre-inclusion',
  }

  const identical = (a: unknown, b: unknown) => a === b

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Probe #{probe.id ?? id} — twin group {probe.twinGroup}</div>
        <h1>
          {ROUTE_LABELS[probe.route]} vs. {ROUTE_LABELS[twin.route]}
        </h1>
        <p>
          Two identical swaps, dispatched in the same cycle through different routes. Same pool, same amount, same
          slippage, same block target — the only variable is the route.
        </p>
      </div>

      {sample && (
        <div className="sample-banner">
          SAMPLE DATA — the Gokuin API at API_URL did not respond for probe {id}. Fixture probe shown below.
        </div>
      )}

      <h2 className="section-title">Twin comparison</h2>
      <div className="twin-grid">
        {[probe, twin].map((p) => (
          <div className="twin-col" key={p.route}>
            <div className="twin-col-head">
              <span>{ROUTE_LABELS[p.route]}</span>
              <VerdictBadge
                bad={p.route === probe.route && derivation.leaked}
                badLabel="leaked"
                goodLabel="clean"
              />
            </div>
            <dl className="kv">
              <dt>pool</dt>
              <dd className={identical(probe.pool, twin.pool) ? 'identical' : ''}>{truncateAddress(p.pool)}</dd>
              <dt>amount in</dt>
              <dd className={identical(probe.amountInWei, twin.amountInWei) ? 'identical' : ''}>
                {weiToEth(p.amountInWei)} ETH
              </dd>
              <dt>slippage</dt>
              <dd className={identical(probe.slippageBps, twin.slippageBps) ? 'identical' : ''}>
                {p.slippageBps} bps
              </dd>
              <dt>from</dt>
              <dd>{truncateAddress(p.fromAddress)}</dd>
              <dt>status</dt>
              <dd>{p.status}</dd>
              <dt>submitted</dt>
              <dd>{p.submittedBlock ?? '—'}</dd>
              <dt>included</dt>
              <dd>{p.includedBlock ?? '—'}</dd>
              <dt>tx</dt>
              <dd>{p.txHash ? <TxHashLink hash={p.txHash} /> : '—'}</dd>
            </dl>
          </div>
        ))}
      </div>
      <p className="small muted">Green values are identical across both legs of the twin — the only lever is the route.</p>

      <h2 className="section-title">Block view — {block ? `block ${block.number}` : 'no sandwich observed'}</h2>
      {block ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">Position</th>
                <th>Role</th>
                <th>From</th>
                <th>Tx hash</th>
              </tr>
            </thead>
            <tbody>
              {block.transactions.map((tx) => (
                <tr key={tx.hash} className={tx.role === 'victim' ? 'row-victim' : ''}>
                  <td className="num">{tx.position}</td>
                  <td>
                    <VerdictBadge bad={tx.role !== 'victim'} badLabel={tx.role} goodLabel="victim" />
                  </td>
                  <td>{truncateAddress(tx.from)}</td>
                  <td>
                    <TxHashLink hash={tx.hash} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">This probe was not sandwiched in the same block — no bracketing transactions to show.</p>
      )}

      <h2 className="section-title">Derivation</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PROVENANCE) as (keyof typeof PROVENANCE)[]).map((metric) => (
              <tr key={metric}>
                <td>{METRIC_LABEL[metric]}</td>
                <td>{metricValue[metric]}</td>
                <td>
                  <ProvenanceBadge provenance={PROVENANCE[metric]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Provenance comes straight from <code>PROVENANCE</code> in <code>@gokuin/core</code> — this table cannot
        drift from what the API and MCP server declare.
      </p>

      <h2 className="section-title">Ledger &amp; listeners</h2>
      <dl className="kv" style={{ marginBottom: '1rem' }}>
        <dt>module version</dt>
        <dd>{derivation.moduleVersion}</dd>
        <dt>ledger tx (Sepolia)</dt>
        <dd>{derivation.ledgerTx ? <TxHashLink hash={derivation.ledgerTx} network="sepolia" /> : 'pending'}</dd>
        <dt>agreeing regions</dt>
        <dd>{derivation.agreeingRegions.join(', ') || 'none'}</dd>
      </dl>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Region</th>
              <th className="num">Seen block</th>
              <th className="num">First seen</th>
              <th>Uncle</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {observations.map((o) => (
              <tr key={`${o.region}-${o.signature}`}>
                <td>{o.region}</td>
                <td className="num">{o.seenBlock}</td>
                <td className="num">{new Date(o.firstSeen).toISOString()}</td>
                <td>{o.fromUncle ? 'yes — excluded' : 'no'}</td>
                <td className="mono small">{o.signature.slice(0, 14)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {probe.submittedBlock && probe.includedBlock
          ? `Inclusion delay: ${delayBlocks(probe.submittedBlock, probe.includedBlock)} blocks (recomputed client-side from delayBlocks() in @gokuin/core).`
          : null}
      </p>
    </main>
  )
}
