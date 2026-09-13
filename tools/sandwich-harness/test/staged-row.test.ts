// Constraint 3's own test, end to end within this harness: a probe this
// harness registers is stored with staged=1 in the real apps/api schema,
// and the Row this harness would hand to ProbeLedger.record() (mirroring
// apps/api/src/derive/settle.ts's own `staged: probe.staged === 1` line)
// carries staged: true and is excluded from scoreRoute()'s figures, using
// REAL-shaped hashes/blocks, not just the synthetic fixture in
// packages/core/test/staged-exclusion.test.ts.
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { openDb } from '../../../apps/api/src/db'
import { scoreRoute, type Row } from '../../../packages/core/src/index'
import { registerStagedProbe } from '../src/db'
import { buildStagedRow } from '../src/row'

const VICTIM = '0x00000000000000000000000000000000000AbC'
const POOL = '0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1'

// A real-shaped victim tx hash, in the same sense the harness's own live run
// produces one. 32 bytes, lowercase, distinct from the frontrun/backrun hashes.
const VICTIM_TX = `0x${'ab'.repeat(32)}` as `0x${string}`

describe('staged row: end to end from db insert to scoreRoute exclusion', () => {
  let db: Database

  beforeEach(() => {
    db = openDb(':memory:')
  })
  afterEach(() => {
    db.close()
  })

  it('registerStagedProbe writes staged=1 into the real probe table', () => {
    const { probeId } = registerStagedProbe(db, {
      cycleId: 1,
      fromAddress: VICTIM,
      pool: POOL,
      amountInWei: 200_000_000_000_000n,
      slippageBps: 10_000,
    })
    const row = db.query('SELECT staged, route, from_address FROM probe WHERE id = ?').get(probeId) as {
      staged: number
      route: string
      from_address: string
    }
    expect(row.staged).toBe(1)
    expect(row.route).toBe('public-mempool')
    expect(row.from_address).toBe(VICTIM)
  })

  it('buildStagedRow always produces staged: true, sandwiched: true', () => {
    const row = buildStagedRow({
      victimTxHash: VICTIM_TX,
      submittedBlock: 9_000_000,
      includedBlock: 9_000_000,
      cycleId: 1,
      extractedWei: 0n,
      simOut: 0n,
      realOut: 0n,
    })
    expect(row.staged).toBe(true)
    expect(row.sandwiched).toBe(true)
    expect(row.mainnetTxHash).toBe(VICTIM_TX)
  })

  it('a staged sandwich row from this harness does not move sandwichBps', () => {
    const organic: Row[] = [
      { ...clean(), },
      { ...clean(), },
      { ...clean(), },
    ]
    const stagedRow = buildStagedRow({
      victimTxHash: VICTIM_TX,
      submittedBlock: 9_000_000,
      includedBlock: 9_000_000,
      cycleId: 1,
      extractedWei: 500n,
      simOut: 1000n,
      realOut: 500n,
    })

    const withoutStaged = scoreRoute('public-mempool', organic)
    const withStaged = scoreRoute('public-mempool', [...organic, stagedRow])

    expect(withoutStaged.sandwichBps).toBe(0)
    expect(withStaged.sandwichBps).toBe(0) // the staged sandwich must not move this
    expect(withStaged.probes).toBe(withoutStaged.probes) // and must not even count as a probe
    expect(withStaged.stagedExcluded).toBe(1)
    expect(withStaged.totalExtractedWei).toBe(withoutStaged.totalExtractedWei) // extractedWei=500 from the staged row must not leak into the total either
  })

  it('a route with ONLY this harness\'s staged rows reports zero probes, not a clean record', () => {
    const stagedRow = buildStagedRow({
      victimTxHash: VICTIM_TX,
      submittedBlock: 9_000_000,
      includedBlock: 9_000_000,
      cycleId: 1,
      extractedWei: 0n,
      simOut: 0n,
      realOut: 0n,
    })
    const s = scoreRoute('public-mempool', [stagedRow])
    expect(s.probes).toBe(0)
    expect(s.sandwichBps).toBe(0)
    expect(s.stagedExcluded).toBe(1)
  })
})

function clean(): Row {
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
  }
}
