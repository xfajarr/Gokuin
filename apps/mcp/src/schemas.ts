// Zod shapes shared between tool registration (input validation, output
// validation) and the test suite (asserting the server exposes exactly the
// contract described in PRD §10).

import { z, type ZodRawShape } from 'zod'

// Each *Shape below is annotated ZodRawShape rather than left to inference.
// Without the annotation tsc re-derives the full generic tree of every field at
// each registerTool call site, and combined with the MCP SDK's own generics it
// stops being slow and starts being unbounded, the typecheck ran past two
// minutes and died on a heap abort, which reads as a crash rather than as a type
// that is simply too expensive to name.
import { ROUTES } from '@gokuin/core'

export const routeIdSchema = z.enum([...ROUTES] as [string, ...string[]])

export const needSchema = z.enum(['privacy', 'speed', 'inclusion', 'cheap'])

export const evidenceItemSchema = z.object({
  txHash: z.string().describe('A real mainnet transaction hash.'),
  what: z.string().describe('Short note on what this specific hash proves.'),
})

// --- gokuin_submit ---------------------------------------------------------

export const submitInputShape: ZodRawShape = {
  tx: z.string().min(1).describe('Raw, already-signed transaction hex (0x-prefixed). Gokuin never signs anything.'),
  need: needSchema.describe(
    "What guarantee this transaction needs: 'privacy' (do not leak pre-inclusion), 'speed' (fastest inclusion), " +
      "'inclusion' (lowest drop/timeout rate), or 'cheap' (lowest cost of getting in).",
  ),
  maxLeakBps: z.number().min(0).max(10_000).optional().describe('Reject any route whose measured leak rate exceeds this, in basis points.'),
  maxWaitBlocks: z.number().min(0).optional().describe('Reject any route whose measured median inclusion delay exceeds this many blocks.'),
}
export const submitInputSchema = z.object(submitInputShape)

export const submitOutputShape: ZodRawShape = {
  hash: z.string().describe('The mainnet transaction hash returned by the chosen route after submission.'),
  route: routeIdSchema.describe('The route the transaction was actually sent through.'),
  reason: z.string().describe('Why this route, in plain language, grounded in its measured record.'),
  evidence: z.array(evidenceItemSchema).describe('Real mainnet tx hashes that back the numbers behind this choice.'),
}
export const submitOutputSchema = z.object(submitOutputShape)

// --- gokuin_routes ----------------------------------------------------------

export const routeScoreSchema = z.object({
  route: routeIdSchema,
  probes: z.number(),
  leaks: z.number(),
  leakBps: z.number(),
  sandwiches: z.number(),
  sandwichBps: z.number(),
  medianDelayBlocks: z.number(),
  totalExtractedWei: z.string(),
  lastCycle: z.number(),
})

export const routesInputShape: ZodRawShape = {}

export const routesOutputShape: ZodRawShape = {
  routes: z.array(routeScoreSchema).describe('Every measured route, most recently scored data from the live subgraph.'),
  reason: z.string().describe('What this list is, and where the numbers come from.'),
  evidence: z
    .array(evidenceItemSchema)
    .describe(
      'Best-effort tx hashes surfaced while compiling this list. Aggregate scores carry no row-level hashes by ' +
        'themselves, call gokuin_explain(route) for the full evidence trail behind any one route.',
    ),
}
export const routesOutputSchema = z.object(routesOutputShape)

// --- gokuin_explain ----------------------------------------------------------

export const explainInputShape: ZodRawShape = {
  route: z.string().min(1).describe(`Route id to explain, e.g. one of: ${ROUTES.join(', ')}. See gokuin_routes for the current list.`),
}

export const explainOutputShape: ZodRawShape = {
  route: z.string(),
  record: routeScoreSchema.nullable().describe('The route\'s full measured record, or null if the API has never scored it.'),
  reason: z.string().describe('Plain-language walkthrough of what each number means and how it was derived.'),
  evidence: z.array(evidenceItemSchema).describe('Real mainnet tx hashes behind the numbers in `record`.'),
}
export const explainOutputSchema = z.object(explainOutputShape)
