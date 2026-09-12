import { createFileRoute } from '@tanstack/react-router'
import {
  MIN_LISTENER_AGREEMENT,
  PROVENANCE,
  REGIONS,
  ROUTES,
  computeExtracted,
  delayBlocks,
  isLeaked,
} from '@gokuin/core'
import { ProvenanceBadge } from '../components/Badge'

export const Route = createFileRoute('/method')({
  component: Method,
})

// A tiny worked example run through the REAL functions from @gokuin/core at
// render time — not restated logic. If these functions change, this page's
// numbers change with them.
const exampleLeak = isLeaked(
  [
    { txHash: '0xexample', region: 'eu-central', firstSeen: 0, seenBlock: 100, fromUncle: false, signature: '0x' },
    { txHash: '0xexample', region: 'us-east', firstSeen: 1, seenBlock: 100, fromUncle: false, signature: '0x' },
  ],
  102,
)
const exampleExtracted = computeExtracted(1_000_000_000_000_000_000n, 997_130_000_000_000_000n)
const exampleDelay = delayBlocks(21_400_812, 21_400_813)

const DEFINITIONS: {
  metric: keyof typeof PROVENANCE
  label: string
  prose: string
  live: string
}[] = [
  {
    metric: 'leaked',
    label: 'leaked',
    prose: `Treatment tx hash observed in the public mempool by at least ${MIN_LISTENER_AGREEMENT} independent signed listeners, at a block height strictly below its inclusion block. Uncle re-broadcasts are excluded and logged separately.`,
    live: `isLeaked(2 listener regions, includedBlock=102) → leaked=${exampleLeak.leaked}, at block ${exampleLeak.leakedAtBlock}`,
  },
  {
    metric: 'sandwiched',
    label: 'sandwiched',
    prose:
      'A tx exists before ours and B after, same block, same pool, opposite directions, distinct hashes, A.from == B.from. Detected by the Substreams module; the API only records the verdict plus the hashes that prove it.',
    live: 'Verdict recorded per-probe by sandwich-detect (Substreams), joined by mainnet tx hash.',
  },
  {
    metric: 'extractedWei',
    label: 'extracted value',
    prose:
      'simOut minus realOut, where simOut is an eth_call of the identical calldata against state at includedBlock − 1. Never negative.',
    live: `computeExtracted(1.0 ETH sim, 0.99713 ETH real) → ${(Number(exampleExtracted) / 1e18).toFixed(5)} ETH`,
  },
  {
    metric: 'delayBlocks',
    label: 'inclusion delay',
    prose: 'includedBlock minus the chain head at the moment of dispatch (submittedBlock).',
    live: `delayBlocks(21400812, 21400813) → ${exampleDelay} block`,
  },
  {
    metric: 'reverted',
    label: 'reverted',
    prose: 'Probe transaction landed on-chain with a reverted status. Read directly off the receipt.',
    live: 'Read from probe.status at settle time — designed, not yet surfaced on this page.',
  },
  {
    metric: 'rebate',
    label: 'rebate',
    prose:
      'Value returned to the sender by routes that share MEV back with builders/searchers (e.g. MEV-Blocker refunds). Net against extractedWei when present.',
    live: 'Designed but unbuilt — no route in this deployment currently pays a measurable rebate.',
  },
]

function Method() {
  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">How Gokuin can be checked</div>
        <h1>Method</h1>
        <p>
          These definitions are rendered from <code>PROVENANCE</code> and the measurement functions exported by{' '}
          <code>@gokuin/core</code> — the same module the API and the MCP server import. One definition, three
          consumers; this page cannot quietly drift from what actually runs.
        </p>
      </div>

      <h2 className="section-title">Measurement definitions</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Definition</th>
              <th>Live from @gokuin/core</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {DEFINITIONS.map((d) => (
              <tr key={d.metric}>
                <td>{d.label}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: '32ch' }}>{d.prose}</td>
                <td className="small mono" style={{ whiteSpace: 'normal', maxWidth: '28ch' }}>
                  {d.live}
                </td>
                <td>
                  <ProvenanceBadge provenance={PROVENANCE[d.metric]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {Object.values(PROVENANCE).filter((p) => p === 'public').length} of {Object.keys(PROVENANCE).length}{' '}
        metrics need no trust in Gokuin at all — anyone can re-derive them from public block data. Routes measured:{' '}
        {ROUTES.join(', ')}. Listener regions: {REGIONS.join(', ')}.
      </p>

      <h2 className="section-title">The six credibility mechanisms</h2>
      <ol>
        <li>
          <strong>Five of six metrics need no trust in Gokuin.</strong> Sandwich, extracted value, delay, revert and
          rebate all derive from public block data via an open-source module.
        </li>
        <li>
          <strong>The leak flag is the one observation</strong> — mitigated four ways: multiple signed listeners;
          TEE-attested observation; a third-party mempool archive as independent cross-check; anyone may run a
          listener.
        </li>
        <li>
          <strong>Commit-reveal kills cherry-picking and omission together.</strong> A gap between committed and
          published is on-chain forever — see any <code>/cycle/$id</code> page.
        </li>
        <li>
          <strong>Rows public, weights private.</strong> The score is a convenience; the rows are the truth. Don't
          like our weights, score it yourself.
        </li>
        <li>
          <strong>Gokuin sits in its own ledger</strong>, disputed and overturned rows public.
        </li>
        <li>
          <strong>Gokuin never sells routing.</strong>
        </li>
      </ol>

      <h2 className="section-title">What is live, simulated, or unbuilt</h2>
      <div className="grid-cards">
        <div className="stat">
          <div className="stat-label">Live</div>
          <div className="small">
            Route probing on mainnet, listener observation, commit/reveal on Sepolia, sandwich detection via
            Substreams, the scoreboard and evidence rows on this site.
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Simulated</div>
          <div className="small">
            <code>extractedWei</code> via <code>eth_call</code> against historical state — deterministic, but not a
            second on-chain transaction.
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Designed, unbuilt</div>
          <div className="small">
            Rebate accounting, revert surfacing on this page, third-party mempool archive cross-check, dispute
            bonding against Gokuin's own ledger.
          </div>
        </div>
      </div>
    </main>
  )
}
