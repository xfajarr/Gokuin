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
  salt: Hex,
): Promise<RevealResult> {
  const cycleRow = stmts.getCycle.get(cycleId) as { probe_count: number } | null
  if (!cycleRow) throw new Error(`unknown cycle ${cycleId}`)

  const probes = stmts.getProbesByCycle.all(cycleId) as { status: string }[]
  const published = probes.filter(p => p.status === 'included' || p.status === 'reverted').length

  const result = await ledger.revealCycle(cycleId, salt)
  stmts.revealCycle.run(salt, Date.now(), result.txHash, cycleId)

  const intact = published === cycleRow.probe_count
  return { cycleId, committed: cycleRow.probe_count, published, intact, tx: result.txHash }
}
