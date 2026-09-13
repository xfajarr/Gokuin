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
const baseEnv = { SUBSTREAMS_PACKAGE: undefined, SUBSTREAMS_ENDPOINT: undefined } as unknown as Env

describe('sandwich verdict is never invented', () => {
  it('throws rather than reporting clean when no subgraph is configured', async () => {
    await expect(fetchSandwichVerdict(baseEnv, HASH, 19_000_000)).rejects.toBeInstanceOf(SandwichVerdictUnavailable)
  })

  it('names the hash and says why, so the operator can fix it', async () => {
    try {
      await fetchSandwichVerdict(baseEnv, HASH, 19_000_000)
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain(HASH)
      expect(msg).toContain('SUBSTREAMS_PACKAGE')
      expect(msg).toContain('did not look')
    }
  })

  // The "module ran and found nothing" case cannot be faked at the fetch boundary
  // any more — the verdict comes from the published Substreams package over gRPC,
  // not from a GraphQL response we can stub. Faking it would test the stub.
  //
  // So this runs for real against the block where we staged a sandwich on Sepolia
  // (tools/sandwich-harness), and self-skips without a key rather than pretending.
  // The staged sandwich is on Sepolia, so the verdict needs the Sepolia build of
  // the module — the published sandwich-detect@v0.1.0 is the mainnet one and its
  // initialBlock (12369621) is above the Sepolia block we are checking. Same Rust,
  // same wasm, different network and initial block.
  const SEPOLIA_PKG = new URL('../../../substreams/sandwich-detect-sepolia-v0.1.0.spkg', import.meta.url).href
  const liveKey = process.env.SUBSTREAMS_API_KEY
  const maybe = liveKey ? it : it.skip

  maybe('finds the staged Sepolia sandwich through the published package', async () => {
    const env = {
      SUBSTREAMS_PACKAGE: SEPOLIA_PKG,
      SUBSTREAMS_ENDPOINT: 'https://sepolia.eth.streamingfast.io:443',
      SUBSTREAMS_API_KEY: liveKey,
    } as unknown as Env

    const v = await fetchSandwichVerdict(
      env,
      '0xf6833083c21d1a6335e6e63b95364e72afa4f8e9bfb1cb34c3c0d71d895c1d4f',
      11693970,
    )
    expect(v.sandwiched).toBe(true)
    expect(v.frontrunHash?.toLowerCase()).toBe('0x7b283b3890f535f1ad229669998846388281a67478c18e5c68eab9b9f72109f5')
    expect(v.backrunHash?.toLowerCase()).toBe('0x379858504f6ecba69cee80cc16bf54e962598a0d3cb4abc5686388df5516ab7e')
  }, 60_000)

  maybe('reports a genuine clean result for a probe with no triple around it', async () => {
    const env = {
      SUBSTREAMS_PACKAGE: SEPOLIA_PKG,
      SUBSTREAMS_ENDPOINT: 'https://sepolia.eth.streamingfast.io:443',
      SUBSTREAMS_API_KEY: liveKey,
    } as unknown as Env

    // Same block, a hash that is not the victim. The module ran; there is no
    // triple around this one. That false is a measurement.
    const v = await fetchSandwichVerdict(env, `0x${'ab'.repeat(32)}`, 11693970)
    expect(v.sandwiched).toBe(false)
  }, 60_000)
})
