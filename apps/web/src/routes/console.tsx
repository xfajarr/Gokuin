import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useRef, useState } from 'react'
import { PROVENANCE, REGIONS, type RouteId } from '@gokuin/core'
import { getIntegrity, getProbe, runCycle } from '../lib/api'
import { truncateAddress, weiToEth } from '../lib/format'
import type { CycleRunInput, CycleRunResult, Derivation, Fetched, Integrity, ProbeDetail } from '../lib/types'
import { ROUTE_LABELS } from '../lib/types'
import { TxHashLink } from '../components/Hash'
import { IntegrityBadge, ProvenanceBadge, VerdictBadge } from '../components/Badge'
import { Term } from '../components/Term'

export const Route = createFileRoute('/console')({
  component: Console,
})

// Bait config defaults (PRD §14 P2: "thin pool, 8% slippage, small size").
// Same pool as the fixture data in sample-data.ts so a clean run and a sample
// page describe the same market. Router is Uniswap V2 mainnet, a
// well-known, non-secret address.
const DEFAULT_POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'
const DEFAULT_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const DEFAULT_AMOUNT_IN_WEI = '50000000000000000' // 0.05 ETH
const DEFAULT_SLIPPAGE_BPS = 800 // 8%: deliberately aggressive bait

// Polling: /admin/cycles/run is synchronous but does not itself wait for
// mainnet inclusion (see apps/api/src/cycle/run.ts's own comment on steps
// 4-7). So the simplest approach that still produces a legible, honest
// sequence on camera is: run the cycle once, then poll the existing read
// endpoints (GET /v1/probes/:id ×2, GET /v1/cycles/:id/integrity) that
// /route/$id, /probe/$id and /cycle/$id already use, until both twin legs
// have a derivation recorded or the window below elapses. See README.md.
const POLL_INTERVAL_MS = 2_500
const MAX_POLLS = 20 // ~50s

type StageKey = 'commit' | 'dispatch' | 'observe' | 'block' | 'derive' | 'record'
type StageStatus = 'pending' | 'active' | 'done' | 'error'

const STAGE_ORDER: { key: StageKey; label: string; title: string }[] = [
  { key: 'commit', label: '01', title: 'Commit, schedule hash before dispatch' },
  { key: 'dispatch', label: '02', title: 'Dispatch, twin transactions, identical params' },
  { key: 'observe', label: '03', title: 'Observe, two listener regions' },
  { key: 'block', label: '04', title: 'Block, sandwich detection' },
  { key: 'derive', label: '05', title: 'Derive, simOut vs realOut' },
  { key: 'record', label: '06', title: 'Record, ledger row & integrity' },
]

const METRIC_LABEL: Record<keyof typeof PROVENANCE, string> = {
  sandwiched: 'sandwiched',
  extractedWei: 'extracted value',
  delayBlocks: 'inclusion delay',
  reverted: 'reverted',
  rebate: 'rebate',
  leaked: 'leaked',
}

function genCycleId(): number {
  // uint16 on-chain (ProbeLedger.Cycle): keep well under 65,536 and fresh
  // per second so back-to-back demo runs don't collide with CycleExists.
  return Math.floor(Date.now() / 1000) % 60_000
}

function sameVal(a: unknown, b: unknown) {
  return a === b ? 'identical' : ''
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wei is not a unit anyone reads at a glance: shown next to the raw input
 * so the operator can see the ETH amount they are about to send. Tolerates
 * a half-typed value instead of throwing on it. */
function safeWeiToEth(wei: string): string {
  if (!/^\d+$/.test(wei)) return 'not a number yet'
  return `= ${weiToEth(wei)} ETH`
}

/** Same idea for the slippage tolerance: bps alone is not readable, so show
 * the plain percentage it maps to next to it. */
function safeBpsToPct(bps: string): string {
  const n = Number(bps)
  if (!Number.isFinite(n)) return 'not a number yet'
  return `= ${(n / 100).toFixed(2)}% max slippage`
}

function initialStages(): Record<StageKey, { status: StageStatus; note: string }> {
  return {
    commit: { status: 'pending', note: 'not started' },
    dispatch: { status: 'pending', note: 'not started' },
    observe: { status: 'pending', note: 'not started' },
    block: { status: 'pending', note: 'not started' },
    derive: { status: 'pending', note: 'not started' },
    record: { status: 'pending', note: 'not started' },
  }
}

function StageBadge({ status }: { status: StageStatus }) {
  if (status === 'done') return <span className="badge badge-good">done</span>
  if (status === 'error') return <span className="badge badge-bad">error</span>
  if (status === 'active') return <span className="badge badge-active">running</span>
  return <span className="badge">pending</span>
}

function DerivationMini({ route, derivation }: { route: RouteId; derivation: Derivation }) {
  const value: Record<keyof typeof PROVENANCE, string> = {
    sandwiched: derivation.sandwiched ? 'yes' : 'no',
    extractedWei: `${weiToEth(derivation.extractedWei)} ETH`,
    delayBlocks: `${derivation.delayBlocks} blocks`,
    reverted: derivation.reverted ? 'yes' : 'no',
    rebate: derivation.rebate ? `${weiToEth(derivation.rebate)} ETH` : 'n/a, not yet instrumented',
    leaked: derivation.leaked ? `leaked at block ${derivation.leakedAtBlock}` : 'not observed pre-inclusion',
  }
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div className="panel-title">{ROUTE_LABELS[route]}</div>
      <dl className="kv" style={{ marginBottom: '0.6rem' }}>
        <dt>simOut</dt>
        <dd>{derivation.simOut}</dd>
        <dt>realOut</dt>
        <dd>{derivation.realOut}</dd>
      </dl>
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
                <td>{value[metric]}</td>
                <td>
                  <ProvenanceBadge provenance={PROVENANCE[metric]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Console() {
  const runCycleFn = useServerFn(runCycle)
  const getProbeFn = useServerFn(getProbe)
  const getIntegrityFn = useServerFn(getIntegrity)

  const [cycleId, setCycleId] = useState(() => genCycleId())
  const [pool, setPool] = useState(DEFAULT_POOL)
  const [router, setRouter] = useState(DEFAULT_ROUTER)
  const [amountInWei, setAmountInWei] = useState(DEFAULT_AMOUNT_IN_WEI)
  const [slippageBps, setSlippageBps] = useState(String(DEFAULT_SLIPPAGE_BPS))

  const [running, setRunning] = useState(false)
  const [stages, setStages] = useState(initialStages())
  const [runResult, setRunResult] = useState<CycleRunResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [legs, setLegs] = useState<{ control: Fetched<ProbeDetail> | null; treatment: Fetched<ProbeDetail> | null }>({
    control: null,
    treatment: null,
  })
  const [integrity, setIntegrity] = useState<Integrity | null>(null)
  const [pollNote, setPollNote] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const cancelRef = useRef(false)

  function updateStage(key: StageKey, status: StageStatus, note: string) {
    setStages((prev) => ({ ...prev, [key]: { status, note } }))
  }

  async function pollUntilSettled(cid: number, probeIds: number[]) {
    const [controlId, treatmentId] = probeIds
    for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
      if (cancelRef.current) return
      setAttempts(attempt)

      const [controlRes, treatmentRes, integrityRes] = await Promise.all([
        getProbeFn({ data: String(controlId) }),
        treatmentId != null ? getProbeFn({ data: String(treatmentId) }) : Promise.resolve(null),
        getIntegrityFn({ data: String(cid) }),
      ])
      if (cancelRef.current) return

      // Rule: never render sample/fixture data on this page. If a read
      // endpoint fell back, that means the API went unreachable mid-poll :
      // say so plainly and stop, keeping whatever real data we already have.
      if (controlRes.sample || treatmentRes?.sample || integrityRes.sample) {
        setPollNote(
          'The API became unreachable while polling for progress. Showing the last real data received: ' +
            'this page never falls back to sample data.',
        )
        return
      }

      setLegs({ control: controlRes, treatment: treatmentRes })
      setIntegrity(integrityRes.data)

      const controlProbe = controlRes.data.probe
      const treatmentProbe = treatmentRes?.data.probe
      if (controlProbe.txHash && (!treatmentProbe || treatmentProbe.txHash)) {
        updateStage('dispatch', 'done', 'both legs signed and submitted from freshly rotated addresses')
      }

      const obsCount = controlRes.data.observations.length + (treatmentRes?.data.observations.length ?? 0)
      updateStage(
        'observe',
        obsCount > 0 ? 'done' : 'active',
        obsCount > 0
          ? `${obsCount} signed observation(s) received so far`
          : `listening for signed observations, attempt ${attempt}/${MAX_POLLS}`,
      )

      const controlDerivation = controlRes.data.derivation
      const treatmentDerivation = treatmentRes?.data.derivation ?? null
      const bothSettled = Boolean(controlDerivation) && (!treatmentProbe || Boolean(treatmentDerivation))

      if (bothSettled) {
        const sandwiched = Boolean(controlRes.data.block) || Boolean(treatmentRes?.data.block)
        updateStage(
          'block',
          'done',
          sandwiched
            ? 'sandwich detected, see block view below'
            : 'clean, no sandwich in either leg this cycle',
        )
        updateStage('derive', 'done', 'simOut vs realOut settled for both legs')
        updateStage('record', 'done', 'row(s) recorded, integrity checked')
        return
      }

      const progress = `awaiting settlement, attempt ${attempt}/${MAX_POLLS}`
      updateStage('block', 'active', progress)
      updateStage('derive', 'active', progress)
      updateStage('record', 'active', progress)

      if (attempt < MAX_POLLS) await sleep(POLL_INTERVAL_MS)
    }

    setPollNote(
      `No settlement observed after ${MAX_POLLS} polls (~${Math.round(
        (MAX_POLLS * POLL_INTERVAL_MS) / 1000,
      )}s). Inclusion and derivation may still be pending server-side, this is an honest incomplete state, not an error.`,
    )
    updateStage('block', 'pending', 'not yet settled')
    updateStage('derive', 'pending', 'not yet settled')
    updateStage('record', 'pending', 'not yet settled')
  }

  async function run() {
    if (running) return
    cancelRef.current = false
    setRunning(true)
    setRunResult(null)
    setRunError(null)
    setLegs({ control: null, treatment: null })
    setIntegrity(null)
    setPollNote(null)
    setAttempts(0)
    setStages(initialStages())
    updateStage('commit', 'active', 'posting schedule hash to Sepolia, before any probe dispatches')

    const input: CycleRunInput = {
      cycleId,
      pool: pool as `0x${string}`,
      router: router as `0x${string}`,
      amountInWei,
      slippageBps: Number(slippageBps),
    }

    let result: CycleRunResult
    try {
      result = await runCycleFn({ data: input })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setRunError(message)
      updateStage('commit', 'error', 'commit failed, see error below')
      updateStage('dispatch', 'error', 'cycle never started')
      updateStage('observe', 'error', 'cycle never started')
      updateStage('block', 'error', 'cycle never started')
      updateStage('derive', 'error', 'cycle never started')
      updateStage('record', 'error', 'cycle never started')
      setRunning(false)
      return
    }

    setRunResult(result)
    updateStage('commit', 'done', `schedule committed for ${result.probeIds.length} probes, before dispatch`)
    updateStage('dispatch', 'active', 'fetching dispatched twin legs…')

    await pollUntilSettled(result.cycleId, result.probeIds)
    setRunning(false)
    setCycleId(genCycleId())
  }

  function stop() {
    cancelRef.current = true
    setRunning(false)
    setPollNote('Stopped by operator before settlement finished.')
  }

  const controlData = legs.control?.data ?? null
  const treatmentData = legs.treatment?.data ?? null
  const block = controlData?.block ?? treatmentData?.block ?? null
  const derivable: { route: RouteId; derivation: Derivation }[] = [
    controlData?.derivation ? { route: controlData.probe.route, derivation: controlData.derivation } : null,
    treatmentData?.derivation ? { route: treatmentData.probe.route, derivation: treatmentData.derivation } : null,
  ].filter((x): x is { route: RouteId; derivation: Derivation } => x !== null)

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Live probe runner, screen-recording surface</div>
        <h1>Console</h1>
        <p className="page-purpose">
          This page runs one real, small measurement live: it commits to a plan, sends two identical transactions
          through different routes, watches what happens to each, and shows every step on this screen as it happens.
        </p>
        <p>
          Runs one real cycle against <code>POST /admin/cycles/run</code>, then polls the same read endpoints{' '}
          <code>/probe/$id</code> and <code>/cycle/$id</code> use to fill in the six stages as the cycle progresses:
          <Term id="commitReveal">commit</Term> → dispatch → observe → block → derive → record.
        </p>
      </div>

      <div className="form-row">
        <label>
          cycle id
          <input inputMode="numeric" value={cycleId} onChange={(e) => setCycleId(Number(e.target.value) || 0)} />
        </label>
        <label>
          pool
          <input value={pool} onChange={(e) => setPool(e.target.value)} />
        </label>
        <label>
          router
          <input value={router} onChange={(e) => setRouter(e.target.value)} />
        </label>
        <label>
          amount in (wei)
          <input inputMode="numeric" value={amountInWei} onChange={(e) => setAmountInWei(e.target.value)} />
          <span className="small muted">{safeWeiToEth(amountInWei)}</span>
        </label>
        <label>
          slippage (<Term id="bps">bps</Term>)
          <input inputMode="numeric" value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} />
          <span className="small muted">{safeBpsToPct(slippageBps)}</span>
        </label>
        <button type="button" className="primary" onClick={run} disabled={running}>
          {running ? `running… (poll ${attempts}/${MAX_POLLS})` : 'run cycle'}
        </button>
        {running && (
          <button type="button" onClick={stop}>
            stop
          </button>
        )}
      </div>

      {runError && (
        <div className="error-banner">
          LIVE CYCLE FAILED: {runError}. This page never falls back to sample data; fix the API connection (or the{' '}
          <code>API_ADMIN_TOKEN</code> / <code>API_URL</code> the web server was started with) and run again.
        </div>
      )}

      {pollNote && <p className="small muted">{pollNote}</p>}

      <div className="stage-list">
        {STAGE_ORDER.map(({ key, label, title }) => {
          const s = stages[key]
          return (
            <section key={key} className={`stage-run is-${s.status}`}>
              <div className="stage-run-num">
                <span className="n">{label}</span>
                {key}
              </div>
              <div className="stage-run-body">
                <div className="stage-run-head">
                  <h3>{title}</h3>
                  <StageBadge status={s.status} />
                </div>
                <p className="small muted stage-run-note">{s.note}</p>

                {key === 'commit' && (
                  <dl className="kv">
                    <dt>cycle id</dt>
                    <dd>{runResult?.cycleId ?? cycleId}</dd>
                    <dt>schedule hash</dt>
                    <dd className="mono small">{runResult?.scheduleHash ?? ':'}</dd>
                    <dt>commit tx (sepolia)</dt>
                    <dd>{runResult ? <TxHashLink hash={runResult.committedTx} network="sepolia" /> : ':'}</dd>
                    <dt>committed count</dt>
                    <dd>{runResult ? runResult.probeIds.length : ':'}</dd>
                  </dl>
                )}

                {key === 'dispatch' &&
                  (controlData ? (
                    <>
                      <div className="twin-grid">
                        {[controlData.probe, controlData.twin].map((p) => (
                          <div className="twin-col" key={p.route}>
                            <div className="twin-col-head">
                              <span>{ROUTE_LABELS[p.route]}</span>
                              <span className="badge">rotated address</span>
                            </div>
                            <dl className="kv">
                              <dt>from</dt>
                              <dd>{truncateAddress(p.fromAddress)}</dd>
                              <dt>pool</dt>
                              <dd className={sameVal(controlData.probe.pool, controlData.twin.pool)}>
                                {truncateAddress(p.pool)}
                              </dd>
                              <dt>amount in</dt>
                              <dd className={sameVal(controlData.probe.amountInWei, controlData.twin.amountInWei)}>
                                {weiToEth(p.amountInWei)} ETH
                              </dd>
                              <dt>slippage</dt>
                              <dd className={sameVal(controlData.probe.slippageBps, controlData.twin.slippageBps)}>
                                {p.slippageBps} bps
                              </dd>
                              <dt>status</dt>
                              <dd>{p.status}</dd>
                              <dt>submitted block</dt>
                              <dd>{p.submittedBlock ?? ':'}</dd>
                              <dt>tx</dt>
                              <dd>{p.txHash ? <TxHashLink hash={p.txHash} /> : ':'}</dd>
                            </dl>
                          </div>
                        ))}
                      </div>
                      <p className="small muted">
                        Green values are identical across both legs, the only variable is the route and the
                        single-use sending address.
                      </p>
                    </>
                  ) : (
                    <p className="muted small">Waiting for dispatch data from GET /v1/probes/:id…</p>
                  ))}

                {key === 'observe' &&
                  (controlData ? (
                    <>
                      <div className="twin-grid">
                        {REGIONS.map((region) => {
                          const controlObs = controlData.observations.find((o) => o.region === region)
                          const treatmentObs = treatmentData?.observations.find((o) => o.region === region)
                          return (
                            <div className="twin-col" key={region}>
                              <div className="twin-col-head">
                                <span>listener {region}</span>
                              </div>
                              <dl className="kv">
                                <dt>control</dt>
                                <dd>{controlObs ? `seen at block ${controlObs.seenBlock}` : 'not seen yet'}</dd>
                                <dt>treatment</dt>
                                <dd>{treatmentObs ? `seen at block ${treatmentObs.seenBlock}` : 'not seen yet'}</dd>
                              </dl>
                            </div>
                          )
                        })}
                      </div>
                      {controlData.derivation && (
                        <p className="small" style={{ marginTop: '0.6rem' }}>
                          <VerdictBadge
                            bad={controlData.derivation.leaked}
                            badLabel="leaked"
                            goodLabel="not leaked"
                          />{' '}
                          control leg: {controlData.derivation.agreeingRegions.length} of {REGIONS.length} listeners
                          agree
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted small">Waiting for listener data…</p>
                  ))}

                {key === 'block' &&
                  (s.status !== 'done' ? null : block ? (
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
                    <p>
                      <VerdictBadge bad={false} badLabel="sandwiched" goodLabel="clean, no sandwich detected" /> :
                      neither leg was bracketed by a front-run/back-run pair in the same block this cycle. A ledger
                      that stays honest when nothing happens is more convincing than one that always finds a villain
                     : the row still gets recorded below.
                    </p>
                  ))}

                {key === 'derive' &&
                  (s.status === 'done' && derivable.length > 0 ? (
                    derivable.map(({ route, derivation }) => (
                      <DerivationMini key={route} route={route} derivation={derivation} />
                    ))
                  ) : null)}

                {key === 'record' &&
                  (s.status === 'done' && derivable.length > 0 ? (
                    <>
                      {derivable.map(({ route, derivation }) => {
                        const probe = route === controlData?.probe.route ? controlData?.probe : treatmentData?.probe
                        return (
                          <dl className="kv" key={route} style={{ marginBottom: '0.75rem' }}>
                            <dt>route</dt>
                            <dd>{ROUTE_LABELS[route]}</dd>
                            <dt>included block</dt>
                            <dd>{probe?.includedBlock ?? ':'}</dd>
                            <dt>leaked</dt>
                            <dd>
                              <VerdictBadge bad={derivation.leaked} badLabel="leaked" goodLabel="clean" />
                            </dd>
                            <dt>sandwiched</dt>
                            <dd>
                              <VerdictBadge bad={derivation.sandwiched} badLabel="sandwiched" goodLabel="kept" />
                            </dd>
                            <dt>extracted</dt>
                            <dd>{weiToEth(derivation.extractedWei)} ETH</dd>
                            <dt>ledger tx (sepolia)</dt>
                            <dd>
                              {derivation.ledgerTx ? <TxHashLink hash={derivation.ledgerTx} network="sepolia" /> : 'pending'}
                            </dd>
                          </dl>
                        )
                      })}
                      {integrity && (
                        <div className="integrity">
                          <span>cycle {runResult?.cycleId} integrity:</span>
                          <span className="num">committed {integrity.committed}</span>
                          <span className="integrity-sep">·</span>
                          <span className="num">published {integrity.published}</span>
                          <span className="integrity-sep">·</span>
                          <IntegrityBadge intact={integrity.intact} />
                        </div>
                      )}
                    </>
                  ) : null)}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
