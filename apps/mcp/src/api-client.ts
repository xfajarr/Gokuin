// Thin client for the Gokuin API's public read + select surface.
//
// PRD §10 / §7.2: the MCP server never guesses a route. Every number an agent
// acts on has to come from GET /v1/routes(/:id) or POST /v1/select. If the API
// cannot be reached, or answers with something that isn't a real score, we
// fail loudly — a wrong route choice costs the caller real money, so a silent
// fallback is strictly worse than an error.

import type { Need, RouteId, RouteScore } from '@gokuin/core'
import { env } from './env'

export interface SelectRequest {
  need: Need
  maxLeakBps?: number
  maxWaitBlocks?: number
}

export interface EvidenceItem {
  txHash: string
  what: string
}

export interface SelectResponse {
  route: RouteId
  reason: string
  evidence: EvidenceItem[]
  runnerUp: RouteId | null
}

export interface RouteRow {
  id: string
  mainnetTxHash: string
  includedBlock: string
  leaked: boolean
  sandwiched: boolean
  extractedWei: string
  cycleId: number
}

export interface RowsPage {
  rows: RouteRow[]
  nextCursor?: string
}

/**
 * Raised for every failure mode: network failure, timeout, non-2xx, or a
 * response shape we can't trust. `.reason` is written to be surfaced verbatim
 * to whatever is calling the MCP tool, so it must say plainly what is wrong
 * and that no route was guessed.
 */
export class GokuinApiError extends Error {
  readonly reason: string
  readonly cause?: unknown

  constructor(reason: string, cause?: unknown) {
    super(reason)
    this.name = 'GokuinApiError'
    this.reason = reason
    this.cause = cause
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${env.apiUrl}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.apiTimeoutMs)

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(env.apiToken ? { authorization: `Bearer ${env.apiToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError'
    throw new GokuinApiError(
      timedOut
        ? `Gokuin API at ${env.apiUrl} did not respond within ${env.apiTimeoutMs}ms. ` +
          `Refusing to pick a route without a live score — check the API is running (set API_URL if it lives elsewhere).`
        : `Gokuin API at ${env.apiUrl} is unreachable (${(err as Error).message}). ` +
          `Refusing to guess a route — no score, no submission. Start apps/api or set API_URL to a reachable instance.`,
      err,
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    let body = ''
    try {
      body = await res.text()
    } catch {
      // ignore
    }
    throw new GokuinApiError(
      `Gokuin API at ${url} returned ${res.status} ${res.statusText}. ${body ? `Body: ${summariseBody(body)}` : ''}`.trim(),
    )
  }

  try {
    return (await res.json()) as T
  } catch (err) {
    throw new GokuinApiError(`Gokuin API at ${url} returned a response that was not valid JSON.`, err)
  }
}

export const gokuinApi = {
  async listRoutes(): Promise<RouteScore[]> {
    return request<RouteScore[]>('/v1/routes')
  },

  async getRoute(id: string): Promise<RouteScore> {
    return request<RouteScore>(`/v1/routes/${encodeURIComponent(id)}`)
  },

  async select(body: SelectRequest): Promise<SelectResponse> {
    return request<SelectResponse>('/v1/select', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  /**
   * Most recent ledger rows for one route — the row-level evidence behind its
   * aggregate score (real mainnet tx hash per row). Not part of the minimal
   * contract this server was speced against (GET /v1/routes(/:id), POST
   * /v1/select), but the deployed API also serves it (mirrors PRD §7.2's
   * `GET /v1/routes/:id/rows`), and it is a strictly better evidence source
   * for `gokuin_explain` than anything derivable from the other three
   * endpoints, so it is used when reachable and quietly skipped when not.
   */
  async getRouteRows(id: string, opts: { limit?: number; cursor?: string } = {}): Promise<RowsPage> {
    const params = new URLSearchParams()
    if (opts.limit !== undefined) params.set('limit', String(opts.limit))
    if (opts.cursor) params.set('cursor', opts.cursor)
    const qs = params.toString()
    return request<RowsPage>(`/v1/routes/${encodeURIComponent(id)}/rows${qs ? `?${qs}` : ''}`)
  },
}

/**
 * An error body goes straight into the calling agent's context, so it is capped
 * and stripped of markup. A misconfigured API_URL can point at any server on the
 * machine — during integration this hit an unrelated app and returned a full HTML
 * document. Untrusted markup from an arbitrary host does not belong in an agent's
 * context window, and a 200-character JSON error says everything a caller needs.
 */
function summariseBody(body: string): string {
  const trimmed = body.trim()
  if (trimmed.startsWith('<')) {
    return `non-JSON response (${trimmed.length} bytes, looks like HTML) — is API_URL pointing at the Gokuin API?`
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}… (${trimmed.length} bytes)` : trimmed
}
