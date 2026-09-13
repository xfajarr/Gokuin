// Re-uses apps/api's own SQLite schema and statements (apps/api/src/db.ts)
// rather than defining a second copy that could drift from the real one —
// the whole point of constraint 3 is that this harness plugs into the exact
// same `probe` table and `staged` column the real settlement path
// (apps/api/src/derive/settle.ts) reads, not a lookalike.
import { openDb, createStatements } from '../../../apps/api/src/db'
import type { Database } from 'bun:sqlite'

export { openDb, createStatements }
export type { Statements } from '../../../apps/api/src/db'

export interface StagedProbeRow {
  cycleId: number
  probeId: number
  fromAddress: `0x${string}`
}

/**
 * Registers our own address as a probe for this demo AND marks it staged in
 * the same insert — there is no window where the row exists but is not yet
 * flagged. `route` is fixed to 'public-mempool': the demo needs the victim
 * transaction visible in the public mempool for the front-run to react to it
 * at all, so this is the only truthful route label for it (this is not a
 * measurement of the public-mempool route's real leak/sandwich rate — see
 * README.md and the `staged` column comment in apps/api/src/db.ts for why
 * scoreRoute() excludes it regardless).
 */
export function registerStagedProbe(
  db: Database,
  opts: { cycleId: number; fromAddress: `0x${string}`; pool: `0x${string}`; amountInWei: bigint; slippageBps: number },
): StagedProbeRow {
  const existingCycle = db.query('SELECT id FROM cycle WHERE id = ?').get(opts.cycleId)
  if (!existingCycle) {
    db.query(
      `INSERT INTO cycle (id, schedule_hash, salt, probe_count, committed_at, committed_tx)
       VALUES (?, ?, NULL, 1, ?, ?)`,
    ).run(opts.cycleId, `0xstaged-demo-cycle-${opts.cycleId}`, Date.now(), 'staged-demo-no-onchain-commit')
  }

  db.query(
    `INSERT INTO probe (cycle_id, route, twin_group, from_address, pool, amount_in_wei, slippage_bps, status, staged)
     VALUES (?, 'public-mempool', ?, ?, ?, ?, ?, 'pending', 1)`,
  ).run(opts.cycleId, crypto.randomUUID(), opts.fromAddress, opts.pool, opts.amountInWei.toString(), opts.slippageBps)

  const inserted = db.query('SELECT last_insert_rowid() as id').get() as { id: number }
  return { cycleId: opts.cycleId, probeId: inserted.id, fromAddress: opts.fromAddress }
}

export function markProbeSubmitted(db: Database, probeId: number, txHash: `0x${string}`, submittedBlock: number) {
  db.query(`UPDATE probe SET tx_hash = ?, submitted_block = ?, submitted_at = ? WHERE id = ?`).run(
    txHash,
    submittedBlock,
    Date.now(),
    probeId,
  )
}

export function markProbeIncluded(db: Database, probeId: number, includedBlock: number) {
  db.query(`UPDATE probe SET included_block = ?, status = 'included' WHERE id = ?`).run(includedBlock, probeId)
}
