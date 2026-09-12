// Compose one Row from probe + observations + derivation, write it through
// ProbeLedger.record() (PRD §7.3 step 8). The metric math is imported from
// @gokuin/core exclusively — this file only wires plumbing around it.
import { computeExtracted, isLeaked, ROUTE_IDS, type Observation, type Row, type RouteId } from '@gokuin/core'
import type { Hex, PublicClient } from 'viem'
import type { Statements } from '../db'
import type { ProbeLedgerClient } from '../chain/ledger'
import { simulateAtBlock, getRealOutFromReceipt } from './simulate'
import { fetchSandwichVerdict } from './sandwich'
import type { Env } from '../env'

export interface SettleDeps {
  env: Env
  stmts: Statements
  publicClient: PublicClient
  ledger: ProbeLedgerClient
}

interface ProbeRow {
  id: number
  cycle_id: number
  route: RouteId
  from_address: Hex
  tx_hash: Hex | null
  amount_in_wei: string
  submitted_block: number | null
  included_block: number | null
  status: string
}

interface ObservationRow {
  region: string
  seen_block: number
  from_uncle: number
}

export async function settleProbe(deps: SettleDeps, probeId: number): Promise<Row> {
  const probe = deps.stmts.getProbe.get(probeId) as ProbeRow | null
  if (!probe) throw new Error(`unknown probe ${probeId}`)
  if (!probe.tx_hash || probe.included_block == null || probe.submitted_block == null) {
    throw new Error(`probe ${probeId} is not ready to settle (status=${probe.status})`)
  }

  const obsRows = deps.stmts.getObservationsByProbe.all(probeId) as ObservationRow[]
  const observations: Observation[] = obsRows.map(o => ({
    txHash: probe.tx_hash!,
    region: o.region as Observation['region'],
    firstSeen: 0,
    seenBlock: o.seen_block,
    fromUncle: o.from_uncle === 1,
    signature: '0x',
  }))
  const { leaked, leakedAtBlock } = isLeaked(observations, probe.included_block)

  const tx = await deps.publicClient.getTransaction({ hash: probe.tx_hash })
  const simOut = await simulateAtBlock(
    deps.publicClient,
    { from: probe.from_address, to: tx.to!, data: tx.input, value: tx.value },
    probe.included_block,
  )
  const realOut = await getRealOutFromReceipt(deps.publicClient, probe.tx_hash, probe.from_address)
  const extractedWei = computeExtracted(simOut, realOut)

  const verdict = await fetchSandwichVerdict(deps.env, probe.tx_hash)

  const row: Row = {
    mainnetTxHash: probe.tx_hash,
    submittedBlock: probe.submitted_block,
    includedBlock: probe.included_block,
    leakedAtBlock: leaked ? leakedAtBlock : 0,
    extractedWei,
    simOut,
    realOut,
    routeId: ROUTE_IDS[probe.route],
    cycleId: probe.cycle_id,
    sandwiched: verdict.sandwiched,
  }

  const ledgerResult = await deps.ledger.record(probe.cycle_id, row)

  deps.stmts.insertDerivation.run(
    probeId,
    simOut.toString(),
    realOut.toString(),
    extractedWei.toString(),
    verdict.sandwiched ? 1 : 0,
    verdict.frontrunHash ?? null,
    verdict.backrunHash ?? null,
    leaked ? 1 : 0,
    leaked ? leakedAtBlock : null,
    verdict.moduleVersion,
    ledgerResult.txHash,
  )

  return row
}
