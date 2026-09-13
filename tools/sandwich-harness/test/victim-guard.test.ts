// Constraint 2's own test: the harness may only target an address already
// on record as our own probe (via the SQLite probe table) or on the
// hardcoded allowlist — never an arbitrary address, and never via an env
// var override (there is no such override to test against; this test
// instead proves the refusal path is real).
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { openDb } from '../../../apps/api/src/db'
import { resolveProbeVictim, UnknownVictimError, KNOWN_PROBE_ALLOWLIST } from '../src/guards/victim-guard'

const THIRD_PARTY_ADDRESS = '0x000000000000000000000000000000DeadBeef'
const OUR_PROBE_ADDRESS = '0x00000000000000000000000000000000000AbC'

describe('resolveProbeVictim', () => {
  let db: Database

  beforeEach(() => {
    db = openDb(':memory:')
  })
  afterEach(() => {
    db.close()
  })

  it('refuses an address that is in neither the probe table nor the allowlist', () => {
    expect(() => resolveProbeVictim(db, THIRD_PARTY_ADDRESS)).toThrow(UnknownVictimError)
  })

  it('resolves an address once it is registered in the probe table', () => {
    db.query(
      `INSERT INTO cycle (id, schedule_hash, salt, probe_count, committed_at, committed_tx) VALUES (1, '0xabc', NULL, 1, 0, 'x')`,
    ).run()
    db.query(
      `INSERT INTO probe (cycle_id, route, twin_group, from_address, pool, amount_in_wei, slippage_bps, status, staged)
       VALUES (1, 'public-mempool', 'twin-1', ?, '0xpool', '1', 100, 'pending', 1)`,
    ).run(OUR_PROBE_ADDRESS)

    const resolved = resolveProbeVictim(db, OUR_PROBE_ADDRESS)
    expect(resolved.source).toBe('probe-table')
    expect(resolved.probeRow).toBeTruthy()
  })

  it('the probe-table lookup is case-insensitive on the address', () => {
    db.query(
      `INSERT INTO cycle (id, schedule_hash, salt, probe_count, committed_at, committed_tx) VALUES (1, '0xabc', NULL, 1, 0, 'x')`,
    ).run()
    db.query(
      `INSERT INTO probe (cycle_id, route, twin_group, from_address, pool, amount_in_wei, slippage_bps, status, staged)
       VALUES (1, 'public-mempool', 'twin-1', ?, '0xpool', '1', 100, 'pending', 1)`,
    ).run(OUR_PROBE_ADDRESS.toUpperCase())

    expect(() => resolveProbeVictim(db, OUR_PROBE_ADDRESS.toLowerCase())).not.toThrow()
  })

  it('falls back to the hardcoded allowlist when the probe table has no match', () => {
    expect(KNOWN_PROBE_ALLOWLIST.length).toBeGreaterThan(0)
    const resolved = resolveProbeVictim(db, KNOWN_PROBE_ALLOWLIST[0])
    expect(resolved.source).toBe('allowlist')
  })

  it('an empty probe table still refuses a random address (no accidental open-door default)', () => {
    expect(() => resolveProbeVictim(db, '0x1111111111111111111111111111111111111111')).toThrow(UnknownVictimError)
  })
})
