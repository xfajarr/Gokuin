import { createFileRoute } from '@tanstack/react-router'
import { PROVENANCE, delayBlocks } from '@gokuin/core'
import { getProbe } from '../lib/api'
import { truncateAddress, weiToEth } from '../lib/format'
import { ROUTE_LABELS } from '../lib/types'
import type { BlockTx, ProbeDetail } from '../lib/types'
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

type CheckStatus = 'pass' | 'fail' | 'unknown'

interface CheckItem {
  key: string
  title: string
  status: CheckStatus
  detail: string
  evidence?: string
}

/** The four observations that make a sandwich a sandwich, checked against the
 * ACTUAL block view for this probe, not asserted. A reader should be able to
 * verify the verdict themselves from what is on screen. */
function buildSandwichChecklist(block: ProbeDetail['block']): CheckItem[] {
  if (!block) {
    return [
      {
        key: 'pool',
        title: '1. Same pool',
        status: 'unknown',
        detail: 'No block view, this probe was not bracketed in the same block, so there is nothing to check.',
      },
      { key: 'direction', title: '2. Opposite directions at the ends', status: 'unknown', detail: 'No block view.' },
      { key: 'attacker', title: '3. Same attacker at positions 1 and 3', status: 'unknown', detail: 'No block view.' },
      { key: 'victim', title: '4. Victim in the middle', status: 'unknown', detail: 'No block view.' },
    ]
  }

  const front = block.transactions.find((t) => t.role === 'frontrun')
  const back = block.transactions.find((t) => t.role === 'backrun')
  const victim = block.transactions.find((t) => t.role === 'victim')

  const sameAttacker = Boolean(front && back && front.from === back.from)
  const oppositeDirection =
    front?.direction && back?.direction ? front.direction !== back.direction : undefined
  const victimBetween = Boolean(front && back && victim && front.position < victim.position && victim.position < back.position)

  return [
    {
      key: 'pool',
      title: '1. Same pool',
      status: 'pass',
      detail: `All three transactions are scoped to one pool by the block view itself.`,
      evidence: `pool ${truncateAddress(block.pool)} · block ${block.number}`,
    },
    {
      key: 'direction',
      title: '2. Opposite directions at the ends',
      status: oppositeDirection === undefined ? 'unknown' : oppositeDirection ? 'pass' : 'fail',
      detail:
        oppositeDirection === undefined
          ? 'Trade direction was not reported for one or both bracketing transactions, this endpoint cannot confirm it, so it is left unknown rather than assumed.'
          : oppositeDirection
            ? 'The front-run and back-run trade in opposite directions (buy, then sell back) which is what turns bracketing into extraction.'
            : 'The front-run and back-run trade in the SAME direction. That is not the sandwich pattern.',
      evidence: front?.direction && back?.direction ? `front-run: ${front.direction} · back-run: ${back.direction}` : undefined,
    },
    {
      key: 'attacker',
      title: '3. Same attacker at positions 1 and 3',
      status: front && back ? (sameAttacker ? 'pass' : 'fail') : 'unknown',
      detail: sameAttacker
        ? 'The front-run and back-run were sent from the identical address, one actor, both ends of the bracket.'
        : 'The front-run and back-run addresses differ. Without one actor on both ends this is not a sandwich.',
      evidence: front && back ? `front-run from ${truncateAddress(front.from)} · back-run from ${truncateAddress(back.from)}` : undefined,
    },
    {
      key: 'victim',
      title: '4. Victim in the middle',
      status: front && back && victim ? (victimBetween ? 'pass' : 'fail') : 'unknown',
      detail: victimBetween
        ? 'The victim transaction sits strictly between the front-run and back-run in block order.'
        : 'No transaction sits strictly between the bracketing pair at this position.',
      evidence: victim ? `victim at position ${victim.position}, bracket at ${front?.position} / ${back?.position}` : undefined,
    },
  ]
}

function CheckIcon({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <span className="check-mark">✓</span>
  if (status === 'fail') return <span className="check-mark">✗</span>
  return <span className="check-mark">?</span>
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
    rebate: derivation.rebate ? `${weiToEth(derivation.rebate)} ETH` : 'n/a, not yet instrumented',
    leaked: derivation.leaked ? `leaked at block ${derivation.leakedAtBlock}` : 'not observed pre-inclusion',
  }

  const identical = (a: unknown, b: unknown) => a === b
  const checklist = buildSandwichChecklist(block)
  const passCount = checklist.filter((c) => c.status === 'pass').length
  const failCount = checklist.filter((c) => c.status === 'fail').length
  const checklistAgrees = derivation.sandwiched ? passCount === 4 : failCount > 0 || passCount === 0

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Probe #{probe.id ?? id}: twin group {probe.twinGroup}</div>
        <h1>
          {ROUTE_LABELS[probe.route]} vs. {ROUTE_LABELS[twin.route]}
        </h1>
        <p>
          Two identical swaps, dispatched in the same cycle through different routes. Same pool, same amount, same
          slippage, same block target, the only variable is the route.
        </p>
      </div>

      {sample && (
        <div className="sample-banner">
          SAMPLE DATA, the Gokuin API at API_URL did not respond for probe {id}. Fixture probe shown below.
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
              <dd>{p.submittedBlock ?? ':'}</dd>
              <dt>included</dt>
              <dd>{p.includedBlock ?? ':'}</dd>
              <dt>tx</dt>
              <dd>{p.txHash ? <TxHashLink hash={p.txHash} /> : ':'}</dd>
            </dl>
          </div>
        ))}
      </div>
      <p className="small muted">Green values are identical across both legs of the twin, the only lever is the route.</p>

      <h2 className="section-title">Block view: {block ? `block ${block.number}` : 'no sandwich observed'}</h2>
      {block ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">Position</th>
                  <th>Role</th>
                  <th>From (attacker candidate)</th>
                  <th>Direction</th>
                  <th>Tx hash</th>
                </tr>
              </thead>
              <tbody>
                {block.transactions.map((tx: BlockTx) => (
                  <tr key={tx.hash} className={tx.role === 'victim' ? 'row-victim' : ''}>
                    <td className="num">{tx.position}</td>
                    <td>
                      <VerdictBadge bad={tx.role !== 'victim'} badLabel={tx.role} goodLabel="victim" />
                    </td>
                    <td>{truncateAddress(tx.from)}</td>
                    <td>{tx.direction ?? ':'}</td>
                    <td>
                      <TxHashLink hash={tx.hash} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="trap-note">
            <strong>Why "From", never "sender".</strong> The address column above is each transaction&rsquo;s{' '}
            <code>from</code>: the EOA that signed it. In a Uniswap <code>Swap</code> event the log&rsquo;s{' '}
            <code>sender</code> field is populated by the <em>router contract</em>, which is identical for the
            attacker&rsquo;s transactions and the victim&rsquo;s alike, since both went through the same router. An
            attacker identified by <code>sender</code> would be indistinguishable from every other trader in the
            pool. Gokuin identifies the attacker by <code>from</code>, and never presents <code>sender</code> as if
            it were the attacker.
          </div>

          <h3 style={{ fontSize: '0.95rem', margin: '1.5rem 0 0.25rem' }}>The four-point sandwich check</h3>
          <p className="small muted" style={{ marginBottom: 0 }}>
            A sandwich is these four observations holding together, not a single number. Checked against the actual
            row above, verify it yourself.
          </p>
          <div className="checklist">
            {checklist.map((c) => (
              <div className={`check-item is-${c.status}`} key={c.key}>
                <CheckIcon status={c.status} />
                <h4>{c.title}</h4>
                <p>{c.detail}</p>
                {c.evidence && <div className="check-evidence">{c.evidence}</div>}
              </div>
            ))}
          </div>
          <p className="verdict-line">
            <VerdictBadge bad={derivation.sandwiched} badLabel="sandwiched" goodLabel="kept" />
            <span className="small muted">
              {passCount} of {checklist.length} checks satisfied · module verdict:{' '}
              {derivation.sandwiched ? 'sandwiched' : 'not sandwiched'}
              {!checklistAgrees && ': checklist evidence does not fully confirm the verdict; see the unmet check(s) above'}
            </span>
          </p>
        </>
      ) : (
        <p className="muted">
          This probe was not sandwiched in the same block, no bracketing transactions to show, and the checklist
          below has nothing to check against.
        </p>
      )}

      <h2 className="section-title">Derivation</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        <strong style={{ color: 'var(--ink)', fontWeight: 400 }}>public</strong> means anyone can re-derive this
        figure from block data alone.{' '}
        <strong style={{ color: 'var(--accent)', fontWeight: 400 }}>attested</strong> means it rests on our own
        listeners' observation, cross-checkable against third-party mempool archives, never independently provable
        the way the others are.
      </p>
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
              <tr key={metric} className={PROVENANCE[metric] === 'attested' ? 'row-attested' : ''}>
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
        Provenance comes straight from <code>PROVENANCE</code> in <code>@gokuin/core</code>: this table cannot
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
                <td>{o.fromUncle ? 'yes, excluded' : 'no'}</td>
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
