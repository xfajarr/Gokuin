// Publish the salt on-chain and assert published == committed (PRD §7.3 step 9,
// §12 "commit-reveal kills cherry-picking and omission together").
import type { Hex } from 'viem'
import type { Statements } from '../db'
import type { ProbeLedgerClient } from '../chain/ledger'

export interface RevealResult {
  cycleId: number
  committed: number
  published: number
  intact: boolean
  tx: Hex
}

export async function revealCycle(
  stmts: Statements,
  ledger: ProbeLedgerClient,
  cycleId: number,
  routeIds: readonly number[],
  slots: readonly number[],
  salt: Hex,
): Promise<RevealResult> {
  const cycleRow = stmts.getCycle.get(cycleId) as { probe_count: number } | null
  if (!cycleRow) throw new Error(`unknown cycle ${cycleId}`)

  // published = probes that actually produced a ledger row, not probes that merely
  // made it into a block. A probe whose sandwich verdict was unavailable is settled
  // nowhere, and the gap must show. Counting inclusion instead would report intact
  // while rows were missing — the precise dishonesty this check exists to catch.
  const probes = stmts.getProbesByCycle.all(cycleId) as { id: number; status: string }[]
  const published = probes.filter(p => stmts.getDerivation.get(p.id) != null).length

  const result = await ledger.revealCycle(cycleId, routeIds, slots, salt)
  stmts.revealCycle.run(salt, Date.now(), result.txHash, cycleId)

  const intact = published === cycleRow.probe_count
  return { cycleId, committed: cycleRow.probe_count, published, intact, tx: result.txHash }
}
