// Server-only. Talks to the Gokuin API over HTTP. Only ever imported from
// inside a createServerFn handler (see api.ts) so this never reaches the
// client bundle and API_URL never leaks to the browser.
import type { Need, Row, RouteScore, Selection } from '@gokuin/core'
import type { CycleRunInput, CycleRunResult, Fetched, Integrity, ProbeDetail, RouteRowsResponse } from './types'

const API_URL = process.env.API_URL ?? 'http://localhost:4000'
// Bearer token for POST /admin/cycles/run (apps/api/src/routes/admin.ts). Read
// only here, at module scope of a file that is never imported outside a
// createServerFn handler — same containment as API_URL above. Confirmed by
// inspecting `bun run build`'s client chunk output: neither this token nor
// its literal env key name appear in dist/client/**.
const API_ADMIN_TOKEN = process.env.API_ADMIN_TOKEN
const TIMEOUT_MS = 4_000
// The live cycle run can take longer than a read — dispatch alone is two
// signed mainnet sends before the endpoint responds.
const RUN_TIMEOUT_MS = 15_000

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${path} responded ${res.status}`)
  return (await res.json()) as T
}

async function withFallback<T>(fallback: T, path: string, init?: RequestInit): Promise<Fetched<T>> {
  try {
    return { data: await requestJson<T>(path, init), sample: false }
  } catch (err) {
    return { data: fallback, sample: true, error: err instanceof Error ? err.message : String(err) }
  }
}

// The API sends 256-bit amounts as decimal strings (same convention as
// RouteScore.totalExtractedWei in @gokuin/core) — bigint isn't valid JSON.
// This mirrors that back onto the bigint fields Row declares.
interface WireRow extends Omit<Row, 'extractedWei' | 'simOut' | 'realOut'> {
  extractedWei: string
  simOut: string
  realOut: string
}

function toRow(w: WireRow): Row {
  return { ...w, extractedWei: BigInt(w.extractedWei), simOut: BigInt(w.simOut), realOut: BigInt(w.realOut) }
}

export function fetchRoutes(fallback: RouteScore[]) {
  return withFallback<RouteScore[]>(fallback, '/v1/routes')
}

export function fetchRoute(id: string, fallback: RouteScore) {
  return withFallback<RouteScore>(fallback, `/v1/routes/${encodeURIComponent(id)}`)
}

export async function fetchRouteRows(
  id: string,
  fallback: RouteRowsResponse,
  cursor?: string,
): Promise<Fetched<RouteRowsResponse>> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const result = await withFallback<{ rows: WireRow[]; cursor?: string }>(
    { rows: [], cursor: undefined },
    `/v1/routes/${encodeURIComponent(id)}/rows${qs}`,
  )
  if (result.sample) return { ...result, data: fallback }
  return { ...result, data: { rows: result.data.rows.map(toRow), cursor: result.data.cursor } }
}

export function fetchProbe(id: string, fallback: ProbeDetail) {
  return withFallback<ProbeDetail>(fallback, `/v1/probes/${encodeURIComponent(id)}`)
}

export function fetchIntegrity(id: string, fallback: Integrity) {
  return withFallback<Integrity>(fallback, `/v1/cycles/${encodeURIComponent(id)}/integrity`)
}

export function postSelect(
  body: { need: Need; maxLeakBps?: number; maxWaitBlocks?: number },
  fallback: Selection,
) {
  return withFallback<Selection>(fallback, '/v1/select', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * POST /admin/cycles/run — drives the live six-stage runner on /console
 * (PRD §7.3, §9.2, §16). Deliberately has NO sample-data fallback, unlike
 * every other function in this file: this is the one page that claims to run
 * a live probe cycle on camera, and rendering a fixture cycle here would
 * present invented evidence as a real measurement. Sample fallback stays
 * correct for the read-only pages (index, route, probe, cycle) — it would be
 * a lie on this one. Do not "fix" this by adding a fallback; let it throw and
 * let the console route surface the failure.
 */
export async function postAdminCycleRun(body: CycleRunInput): Promise<CycleRunResult> {
  if (!API_ADMIN_TOKEN) {
    throw new Error('API_ADMIN_TOKEN is not configured on the web server — cannot run a live cycle.')
  }
  const res = await fetch(`${API_URL}/admin/cycles/run`, {
    method: 'POST',
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_ADMIN_TOKEN}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`POST /admin/cycles/run responded ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return (await res.json()) as CycleRunResult
}
