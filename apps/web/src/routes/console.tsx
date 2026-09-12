import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import type { Need } from '@gokuin/core'
import { selectRoute } from '../lib/api'
import type { Fetched } from '../lib/types'
import type { Selection } from '@gokuin/core'
import { TxHashLink } from '../components/Hash'

export const Route = createFileRoute('/console')({
  component: Console,
})

const NEEDS: Need[] = ['privacy', 'speed', 'inclusion', 'cheap']

interface LogEntry {
  t: string
  stage: string
  msg: string
  status: 'pending' | 'done' | 'error'
}

function Console() {
  const runSelect = useServerFn(selectRoute)
  const [need, setNeed] = useState<Need>('privacy')
  const [maxLeakBps, setMaxLeakBps] = useState('')
  const [maxWaitBlocks, setMaxWaitBlocks] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])
  const [result, setResult] = useState<Fetched<Selection> | null>(null)
  const [busy, setBusy] = useState(false)

  function push(stage: string, msg: string, status: LogEntry['status'] = 'pending') {
    setLog((prev) => [...prev, { t: new Date().toLocaleTimeString(), stage, msg, status }])
  }

  async function run() {
    setBusy(true)
    setResult(null)
    setLog([])
    push(
      'dispatch',
      `POST /v1/select — need=${need}${maxLeakBps ? `, maxLeakBps=${maxLeakBps}` : ''}${
        maxWaitBlocks ? `, maxWaitBlocks=${maxWaitBlocks}` : ''
      }`,
    )
    try {
      const res = await runSelect({
        data: {
          need,
          maxLeakBps: maxLeakBps ? Number(maxLeakBps) : undefined,
          maxWaitBlocks: maxWaitBlocks ? Number(maxWaitBlocks) : undefined,
        },
      })
      push(
        'scored',
        res.sample ? 'API unreachable — fell back to sample selection' : 'routes scored against request',
        res.sample ? 'error' : 'done',
      )
      push('selected', `route=${res.data.route}, runnerUp=${res.data.runnerUp ?? 'none'}`, 'done')
      setResult(res)
    } catch (err) {
      push('error', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <div className="page-head">
        <div className="eyebrow">Live probe runner</div>
        <h1>Console</h1>
        <p>
          Calls <code>POST /v1/select</code> for real, with the parameters below. The response always carries a{' '}
          <code>reason</code> and <code>evidence</code> — an agent that can&rsquo;t explain why it picked a route is
          no better than a hardcoded URL.
        </p>
      </div>

      <div className="form-row">
        <label>
          need
          <select value={need} onChange={(e) => setNeed(e.target.value as Need)}>
            {NEEDS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          max leak bps
          <input
            inputMode="numeric"
            placeholder="optional"
            value={maxLeakBps}
            onChange={(e) => setMaxLeakBps(e.target.value)}
          />
        </label>
        <label>
          max wait blocks
          <input
            inputMode="numeric"
            placeholder="optional"
            value={maxWaitBlocks}
            onChange={(e) => setMaxWaitBlocks(e.target.value)}
          />
        </label>
        <button type="button" className="primary" onClick={run} disabled={busy}>
          {busy ? 'running…' : 'run selection'}
        </button>
      </div>

      <h2 className="section-title">Stage log</h2>
      {log.length === 0 ? (
        <p className="muted small">No run yet — press &ldquo;run selection&rdquo;.</p>
      ) : (
        <ul className="console-log">
          {log.map((entry, i) => (
            <li key={i} className={entry.status}>
              <span className="t">{entry.t}</span>
              <span className="stage">{entry.stage}</span>
              <span className="msg">{entry.msg}</span>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <>
          <h2 className="section-title">Selection</h2>
          {result.sample && (
            <div className="sample-banner">
              SAMPLE DATA — /v1/select was unreachable; this is the fixture decision, not a live measurement.
            </div>
          )}
          <div className="panel">
            <div className="panel-title">Chosen route</div>
            <div className="stat-value num accent" style={{ marginBottom: '0.75rem' }}>
              {result.data.route}
            </div>
            <p>{result.data.reason}</p>
            <p className="small muted">Runner up: {result.data.runnerUp ?? 'none'}</p>
            <div className="panel-title" style={{ marginTop: '1rem' }}>
              Evidence
            </div>
            <ul>
              {result.data.evidence.map((e, i) => (
                <li key={i} className="small">
                  <TxHashLink hash={e.txHash} /> — {e.what}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  )
}
