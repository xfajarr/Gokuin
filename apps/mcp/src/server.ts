// Builds the Gokuin MCP server: three tools, both wired to the same rule —
// no route is ever picked, and no number is ever reported, without a `reason`
// and `evidence` attached. See PRD §10, §12.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Need, RouteId, RouteScore } from '@gokuin/core'
import { NEEDS } from './needs'
import { gokuinApi, GokuinApiError, type EvidenceItem } from './api-client'
import { submitViaRoute, RouteTransportError } from './route-transports'
import {
  submitInputShape,
  submitOutputShape,
  routesInputShape,
  routesOutputShape,
  explainInputShape,
  explainOutputShape,
} from './schemas'

function textResult(payload: unknown): CallToolResult['content'] {
  return [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

function describeRouteScore(score: RouteScore): string {
  return (
    `${score.route}: ${score.probes} probes so far, ${score.leaks} leaked ` +
    `(${score.leakBps} bps — the one attested metric, cross-checked against listener signatures), ` +
    `${score.sandwiches} sandwiched (${score.sandwichBps} bps — publicly re-derivable from block data), ` +
    `median inclusion delay ${score.medianDelayBlocks} blocks, ${score.totalExtractedWei} wei extracted in total, ` +
    `last scored in cycle ${score.lastCycle}.`
  )
}

/**
 * Primary evidence source for gokuin_explain: the route's own recent ledger
 * rows, each one a real mainnet tx hash with the number it produced. Empty
 * (never thrown) if the endpoint is unreachable or the route has no rows yet
 * — callers fall back to `collectEvidenceFromSelect` in that case.
 */
async function collectEvidenceFromRows(route: string): Promise<EvidenceItem[]> {
  try {
    const page = await gokuinApi.getRouteRows(route, { limit: 10 })
    return page.rows.map((row) => ({
      txHash: row.mainnetTxHash,
      what: row.leaked
        ? `leaked to the public mempool before inclusion at block ${row.includedBlock} (cycle ${row.cycleId})`
        : row.sandwiched
          ? `sandwiched in block ${row.includedBlock}, ${row.extractedWei} wei extracted (cycle ${row.cycleId})`
          : `included cleanly at block ${row.includedBlock}, no leak or sandwich (cycle ${row.cycleId})`,
    }))
  } catch {
    return []
  }
}

/**
 * Fallback evidence for a specific route id, gathered by asking /v1/select
 * for every `need` and keeping whatever evidence it attaches whenever this
 * route comes back as the winner. Used only when row-level evidence isn't
 * available — real hashes when the route has won something recently, an
 * explicit empty result (never a fabricated hash) when it hasn't.
 */
async function collectEvidenceFromSelect(route: string): Promise<EvidenceItem[]> {
  const seen = new Map<string, EvidenceItem>()
  await Promise.all(
    NEEDS.map(async (need) => {
      try {
        const pick = await gokuinApi.select({ need })
        if (pick.route === route) {
          for (const e of pick.evidence) seen.set(e.txHash, e)
        }
      } catch {
        // A single need failing to resolve shouldn't blank out evidence we
        // already gathered from the others — gokuin_explain still reports
        // what it has, and callers can see the record is possibly partial.
      }
    }),
  )
  return [...seen.values()]
}

async function collectEvidenceForRoute(route: string): Promise<{ evidence: EvidenceItem[]; source: 'rows' | 'select' | 'none' }> {
  const fromRows = await collectEvidenceFromRows(route)
  if (fromRows.length) return { evidence: fromRows, source: 'rows' }
  const fromSelect = await collectEvidenceFromSelect(route)
  return { evidence: fromSelect, source: fromSelect.length ? 'select' : 'none' }
}

/**
 * `server.registerTool` infers a generic over every field of both schemas, and
 * the MCP SDK's own generics compound it — tsc reported TS2589, "type
 * instantiation is excessively deep", and before the shapes were annotated it
 * ran past two minutes and died on a heap abort that looked like a crash.
 *
 * The schemas still validate at runtime; zod is doing the work either way. What
 * is given up is compile-time inference of the handler's argument type, which
 * the SDK was deriving at a cost out of proportion to the guarantee. Each
 * handler annotates its own args instead.
 */
type RegisterTool = (name: string, config: unknown, handler: (args: any) => Promise<CallToolResult>) => void

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'gokuin', version: '0.1.0' })
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool

  registerTool(
    'gokuin_submit',
    {
      title: 'Submit a transaction through the best-measured route',
      description:
        'Send a raw signed transaction through whichever route\'s measured record best matches the guarantee ' +
        'you need (privacy, speed, inclusion or cheap). Calls the Gokuin API\'s POST /v1/select to pick a route ' +
        'from live measured scores, submits the transaction through that route\'s own transport, and returns the ' +
        'resulting hash together with why that route was chosen and the mainnet evidence behind the choice. ' +
        'Never falls back to a guess: if the Gokuin API cannot be reached, this tool fails with a clear error ' +
        'instead of picking a route blind, because a wrong choice here costs real money.',
      inputSchema: submitInputShape,
      outputSchema: submitOutputShape,
    },
    async (args): Promise<CallToolResult> => {
      let pick: Awaited<ReturnType<typeof gokuinApi.select>>
      try {
        pick = await gokuinApi.select({
          need: args.need,
          maxLeakBps: args.maxLeakBps,
          maxWaitBlocks: args.maxWaitBlocks,
        })
      } catch (err) {
        const reason = err instanceof GokuinApiError ? err.reason : `Route selection failed: ${String(err)}`
        return errorResult(reason)
      }

      let hash: string
      try {
        hash = await submitViaRoute(pick.route, args.tx)
      } catch (err) {
        const reason =
          err instanceof RouteTransportError
            ? err.reason
            : `Submitting through route "${pick.route}" failed: ${String(err)}`
        return errorResult(
          `${reason} (Gokuin selected route "${pick.route}" because: ${pick.reason} — the transaction was NOT sent.)`,
        )
      }

      const payload = {
        hash,
        route: pick.route,
        reason: pick.reason,
        evidence: pick.evidence,
      }
      return { content: textResult(payload), structuredContent: payload }
    },
  )

  registerTool(
    'gokuin_routes',
    {
      title: 'List every measured route and its current score',
      description:
        'Lists every route Gokuin has probed, with its current measured scores (leak rate, sandwich rate, ' +
        'median inclusion delay, total value extracted, probe count). Reads live from the Gokuin API\'s ' +
        'GET /v1/routes, which itself reads only from the Substreams-powered subgraph — never a local cache. ' +
        'Use this to decide which route to ask gokuin_explain about, or before calling gokuin_submit if you want ' +
        'to see the numbers yourself first.',
      inputSchema: routesInputShape,
      outputSchema: routesOutputShape,
    },
    async (): Promise<CallToolResult> => {
      let routes: RouteScore[]
      try {
        routes = await gokuinApi.listRoutes()
      } catch (err) {
        const reason = err instanceof GokuinApiError ? err.reason : `Listing routes failed: ${String(err)}`
        return errorResult(reason)
      }

      const payload = {
        routes,
        reason:
          `${routes.length} route(s) measured. Scores read live from GET /v1/routes (Substreams-powered ` +
          `subgraph behind it, never a local cache). Five of six underlying metrics are publicly re-derivable ` +
          `from block data; the leak rate is the one attested metric, cross-checked against signed listener ` +
          `observations. Call gokuin_explain(route) for the evidence hashes behind any single route's numbers.`,
        evidence: [] as EvidenceItem[],
      }
      return { content: textResult(payload), structuredContent: payload }
    },
  )

  registerTool(
    'gokuin_explain',
    {
      title: "Explain one route's full record and evidence",
      description:
        'Returns one route\'s full measured record (from GET /v1/routes/:id) plus the real mainnet transaction ' +
        'hashes that back its numbers — its own recent ledger rows when available, or recent route-selection ' +
        'evidence otherwise. Use this before trusting gokuin_submit\'s choice, or to answer "why did/should this ' +
        'route be picked" with something checkable.',
      inputSchema: explainInputShape,
      outputSchema: explainOutputShape,
    },
    async (args): Promise<CallToolResult> => {
      let record: RouteScore | null = null
      try {
        record = await gokuinApi.getRoute(args.route)
      } catch (err) {
        if (err instanceof GokuinApiError) {
          return errorResult(err.reason)
        }
        return errorResult(`Fetching route "${args.route}" failed: ${String(err)}`)
      }

      const { evidence, source } = await collectEvidenceForRoute(args.route)

      const reason = record
        ? describeRouteScore(record) +
          (source === 'rows'
            ? ` Evidence below is this route's own most recent ledger rows (GET /v1/routes/:id/rows), each a real mainnet tx.`
            : source === 'select'
              ? ` Row-level evidence wasn't available; the hashes below are drawn from recent route selections that picked this route instead.`
              : ` No row-level or recent-selection evidence was available for this route — the record above is still ` +
                `live from the subgraph, but no fresh mainnet hashes were available to attach.`)
        : `Gokuin has no score on file for route "${args.route}".`

      const payload = { route: args.route, record, reason, evidence }
      return { content: textResult(payload), structuredContent: payload }
    },
  )

  return server
}
