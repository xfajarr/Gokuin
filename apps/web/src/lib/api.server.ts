// Server-only. Talks to the Gokuin API over HTTP. Only ever imported from
// inside a createServerFn handler (see api.ts) so this never reaches the
// client bundle and API_URL never leaks to the browser.
import type { Need, Row, RouteScore, Selection } from '@gokuin/core'
import type { Fetched, Integrity, ProbeDetail, RouteRowsResponse } from './types'

const API_URL = process.env.API_URL ?? 'http://localhost:4000'
const TIMEOUT_MS = 4_000

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
