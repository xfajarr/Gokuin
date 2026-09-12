// A row in ProbeLedger is permanent and says a named company's route was clean.
// The API must never produce one from an absent measurement.
//
// Two cases previously both returned sandwiched: false — "we looked and found
// none", which is a measurement, and "we never looked", which is a claim we had
// no basis for. Only the first is allowed to reach a row.
import { describe, expect, it } from 'bun:test'
import { fetchSandwichVerdict, SandwichVerdictUnavailable } from '../src/derive/sandwich'
import type { Env } from '../src/env'

const HASH = '0x7c2d07b800000000000000000000000000000000000000000000000000009b4252' as const
const baseEnv = { SUBGRAPH_URL: undefined } as unknown as Env

describe('sandwich verdict is never invented', () => {
  it('throws rather than reporting clean when no subgraph is configured', async () => {
    await expect(fetchSandwichVerdict(baseEnv, HASH)).rejects.toBeInstanceOf(SandwichVerdictUnavailable)
  })

  it('names the hash and says why, so the operator can fix it', async () => {
    try {
      await fetchSandwichVerdict(baseEnv, HASH)
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain(HASH)
      expect(msg).toContain('SUBGRAPH_URL')
      expect(msg).toContain('did not look')
    }
  })

  it('still reports a genuine clean result when the subgraph answers with no match', async () => {
    const env = { SUBGRAPH_URL: 'http://subgraph.test/graphql' } as unknown as Env
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { sandwich: null } }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    try {
      const v = await fetchSandwichVerdict(env, HASH)
      expect(v.sandwiched).toBe(false)
      expect(v.moduleVersion).toBe('sandwich-detect')
    } finally {
      globalThis.fetch = original
    }
  })
})
