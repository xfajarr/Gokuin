// A staged row is one where we executed the sandwich ourselves against our own
// probe, to show the detection path works on camera. It is evidence about the
// DETECTOR, not about the ROUTE.
//
// If a staged row reached sandwichBps, Gokuin would be publishing a manufactured
// figure about a named company — the exact thing it exists to object to. These
// tests make that structurally impossible rather than a matter of discipline.
import { describe, expect, it } from 'bun:test'
import { scoreRoute, type Row } from '../src/index'

function row(over: Partial<Row> = {}): Row {
  return {
    mainnetTxHash: `0x${'11'.repeat(32)}`,
    submittedBlock: 100,
    includedBlock: 101,
    leakedAtBlock: 0,
    extractedWei: 0n,
    simOut: 0n,
    realOut: 0n,
    routeId: 0,
    cycleId: 1,
    sandwiched: false,
    staged: false,
    ...over,
  }
}

describe('staged rows never reach a route score', () => {
  it('a staged sandwich does not move sandwichBps', () => {
    const organic = [row(), row(), row(), row()]
    const clean = scoreRoute('public-mempool', organic)
    const withStaged = scoreRoute('public-mempool', [...organic, row({ sandwiched: true, staged: true })])

    expect(clean.sandwichBps).toBe(0)
    expect(withStaged.sandwichBps).toBe(0)
    expect(withStaged.probes).toBe(clean.probes)
  })

  it('an organic sandwich still does move it — the exclusion is not a mute button', () => {
    const s = scoreRoute('public-mempool', [row(), row(), row(), row({ sandwiched: true })])
    expect(s.sandwichBps).toBe(2500)
  })

  it('staged rows are excluded from extracted value and leaks too, not just sandwiches', () => {
    const s = scoreRoute('public-mempool', [
      row(),
      row({ sandwiched: true, staged: true, extractedWei: 999n, leakedAtBlock: 50 }),
    ])
    expect(s.totalExtractedWei).toBe('0')
    expect(s.leaks).toBe(0)
    expect(s.probes).toBe(1)
  })

  it('reports how many it withheld, so the exclusion is visible and not silent', () => {
    const s = scoreRoute('public-mempool', [row(), row({ staged: true }), row({ staged: true })])
    expect(s.stagedExcluded).toBe(2)
  })

  it('a route of nothing but staged rows scores as no data, not as clean', () => {
    const s = scoreRoute('mev-blocker', [row({ staged: true }), row({ sandwiched: true, staged: true })])
    expect(s.probes).toBe(0)
    expect(s.sandwichBps).toBe(0)
    expect(s.stagedExcluded).toBe(2)
    // probes === 0 is what tells a reader there is no evidence here. A UI must not
    // render "0% sandwiched" from this as though the route had been tested.
  })
})
