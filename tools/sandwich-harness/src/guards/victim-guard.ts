// Constraint 2: this harness may only ever target an address that is
// genuinely ours — one already on record as a Gokuin probe. Sandwiching a
// third party takes real money from a real person; that is not a
// configuration option here, it is a guard with its own test
// (test/victim-guard.test.ts) that runs before anything else.
//
// Two sources of truth, both under our control, neither an env var:
//
//   1. apps/api's own SQLite `probe` table (apps/api/src/db.ts) — the same
//      table the real system records probes into. If the harness (or the
//      real API) has already registered this address as a probe, it is ours
//      by construction.
//   2. KNOWN_PROBE_ALLOWLIST below — a short, hardcoded, committed-to-source
//      list of addresses we control. Hardcoded on purpose: an allowlist read
//      from an environment variable could be pointed at anything by whoever
//      sets that variable, which is exactly the override this constraint
//      forbids ("never overridable by env var"). Changing this list means
//      changing and reviewing source code, not flipping a flag.
//
// If neither source recognises the address, this throws. There is no
// parameter that skips the check.
import type { Database } from 'bun:sqlite'

/**
 * Addresses we control and have explicitly designated as our own demo
 * probes. Sourced from repo-root .env's PROBER_ADDRESS at the time this file
 * was written (`cast wallet address --private-key $PROBER_PK`) — the same
 * address apps/api's ProbeLedger.prober is deployed to sign for. Add an
 * address here only when it is genuinely one of ours; this is read by
 * source review, not by a script.
 */
export const KNOWN_PROBE_ALLOWLIST: readonly `0x${string}`[] = ['0xD6499869a0d8f5bbc23e919445f5E3e1a8CC0e77']

export class UnknownVictimError extends Error {
  constructor(public readonly address: string) {
    super(
      `refusing to target ${address}: it is not in the probe table and not in ` +
        `KNOWN_PROBE_ALLOWLIST. This harness may only target addresses we ` +
        `already control as our own probes — sandwiching anyone else is out of ` +
        `scope structurally, not by policy.`,
    )
    this.name = 'UnknownVictimError'
  }
}

export interface ResolvedVictim {
  address: `0x${string}`
  source: 'probe-table' | 'allowlist'
  /** Present only when source === 'probe-table'. */
  probeRow?: Record<string, unknown>
}

/**
 * Resolves and authorizes a victim address against the probe table, falling
 * back to the hardcoded allowlist. Throws UnknownVictimError if neither
 * source recognises it — the caller must not catch this and proceed anyway.
 */
export function resolveProbeVictim(db: Database, address: string): ResolvedVictim {
  const normalized = address.toLowerCase() as `0x${string}`

  const row = db
    .query(`SELECT * FROM probe WHERE lower(from_address) = ?`)
    .get(normalized) as Record<string, unknown> | null

  if (row) {
    return { address: normalized, source: 'probe-table', probeRow: row }
  }

  if (KNOWN_PROBE_ALLOWLIST.some(a => a.toLowerCase() === normalized)) {
    return { address: normalized, source: 'allowlist' }
  }

  throw new UnknownVictimError(address)
}
