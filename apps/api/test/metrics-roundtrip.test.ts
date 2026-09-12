// Metric functions round-tripping through the API: the core definitions
// (computeExtracted, isLeaked, scoreRoute's bps rounding) must produce the
// exact same numbers whether called directly from @gokuin/core or read back
// through the live Elysia app's HTTP responses (GET /v1/routes, POST
// /v1/select), with the subgraph mocked at the fetch boundary — the API layer
// must not silently redefine or drift from packages/core.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { computeExtracted, isLeaked, type Observation } from '@gokuin/core'

// Env must be set BEFORE src/index.ts is first imported (it builds its
// context at module load time).
process.env.DB_PATH = ':memory:'
process.env.SUBGRAPH_URL = 'http://fixture.invalid/graphql'
process.env.API_ADMIN_TOKEN = 'test-admin-token'
process.env.MAINNET_RPC = 'http://127.0.0.1:8545'
process.env.SEPOLIA_RPC = 'http://127.0.0.1:8545'

const FIXTURE_ROUTES = [
  { id: 'flashbots-protect', probes: '10', leaks: '1', sandwiches: '0', totalExtractedWei: '500', medianDelayBlocks: '2', lastCycle: '3' },
  { id: 'mev-blocker', probes: '10', leaks: '3', sandwiches: '1', totalExtractedWei: '900', medianDelayBlocks: '1', lastCycle: '3' },
  { id: 'public-mempool', probes: '10', leaks: '10', sandwiches: '2', totalExtractedWei: '2000', medianDelayBlocks: '1', lastCycle: '3' },
]

const FIXTURE_ROWS = [
  { id: 'row-1', mainnetTxHash: '0xfeed000000000000000000000000000000000000000000000000000000fe', includedBlock: '19000010', leaked: false, sandwiched: false, extractedWei: '0', cycleId: 3 },
]

const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = (async (url: any, init?: any) => {
    if (!String(url).includes('fixture.invalid')) {
      throw new Error(`unexpected fetch to ${url} in test`)
    }
    const body = JSON.parse(init.body)
    if ((body.query as string).includes('routes(first')) {
      return new Response(JSON.stringify({ data: { routes: FIXTURE_ROUTES } }), { status: 200 })
    }
    if ((body.query as string).includes('rows(first')) {
      return new Response(JSON.stringify({ data: { rows: FIXTURE_ROWS } }), { status: 200 })
    }
    throw new Error(`unexpected subgraph query: ${body.query}`)
  }) as any
})

afterAll(() => {
  global.fetch = originalFetch
})

describe('pure metric functions (sanity, direct from @gokuin/core)', () => {
  test('computeExtracted never goes negative', () => {
    expect(computeExtracted(100n, 40n)).toBe(60n)
    expect(computeExtracted(40n, 100n)).toBe(0n)
  })

  test('isLeaked requires >=2 independent regions strictly below inclusion, excludes uncle rebroadcasts', () => {
    const includedBlock = 100
    const obs: Observation[] = [
      { txHash: '0xabc', region: 'eu-central', firstSeen: 1, seenBlock: 90, fromUncle: false, signature: '0x' },
      { txHash: '0xabc', region: 'us-east', firstSeen: 2, seenBlock: 95, fromUncle: false, signature: '0x' },
      { txHash: '0xabc', region: 'eu-central', firstSeen: 3, seenBlock: 50, fromUncle: true, signature: '0x' },
    ]
    const verdict = isLeaked(obs, includedBlock)
    expect(verdict.leaked).toBe(true)
    expect(verdict.leakedAtBlock).toBe(90)
    expect(verdict.agreeingRegions.sort()).toEqual(['eu-central', 'us-east'])
  })

  test('isLeaked is false with only one agreeing region', () => {
    const obs: Observation[] = [
      { txHash: '0xabc', region: 'eu-central', firstSeen: 1, seenBlock: 90, fromUncle: false, signature: '0x' },
    ]
    expect(isLeaked(obs, 100).leaked).toBe(false)
  })
})

describe('metrics round-tripping through the live API', () => {
  test('GET /v1/routes returns bps computed with the same rounding as scoreRoute()', async () => {
    const { app } = await import('../src/index')
    const res = await app.handle(new Request('http://localhost/v1/routes'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as any[]
    expect(json).toHaveLength(3)

    const fb = json.find(r => r.route === 'flashbots-protect')
    // same formula as scoreRoute()'s internal bps(): Math.round((n/total)*10000)
    expect(fb.leakBps).toBe(Math.round((1 / 10) * 10_000))
    expect(fb.sandwichBps).toBe(0)
    expect(fb.totalExtractedWei).toBe('500')

    const mb = json.find(r => r.route === 'mev-blocker')
    expect(mb.leakBps).toBe(Math.round((3 / 10) * 10_000))
  })

  test('POST /v1/select picks the lowest leak rate for need=privacy and cites real tx hashes', async () => {
    const { app } = await import('../src/index')
    const res = await app.handle(
      new Request('http://localhost/v1/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ need: 'privacy' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { route: string; reason: string; evidence: { txHash: string; what: string }[]; runnerUp: string | null }

    expect(json.route).toBe('flashbots-protect') // lowest leakBps of the three fixture routes
    expect(json.reason).toContain('flashbots-protect')
    expect(json.evidence.length).toBeGreaterThan(0)
    expect(json.evidence[0].txHash).toBe(FIXTURE_ROWS[0].mainnetTxHash)
    expect(json.runnerUp).not.toBeNull()
    expect(json.runnerUp).not.toBe(json.route)
  })

  test('GET /health reports ledger dry-run and subgraph configuration truthfully', async () => {
    const { app } = await import('../src/index')
    const res = await app.handle(new Request('http://localhost/health'))
    const json = (await res.json()) as { ok: boolean; ledgerDryRun: boolean; subgraphConfigured: boolean }
    expect(json.ok).toBe(true)
    expect(json.ledgerDryRun).toBe(true) // no PROBER_PK/PROBE_LEDGER_ADDRESS set in this test env
    expect(json.subgraphConfigured).toBe(true)
  })
})
