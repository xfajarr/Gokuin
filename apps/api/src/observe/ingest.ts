// Verify the listener signature by recovering the signer over the canonical
// message and checking an allowlist, then store the observation. This is the
// only write path into SQLite from outside the process (PRD §7.2).
import { recoverMessageAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Env } from '../env'
import type { Statements } from '../db'
import { canonicalObservation } from './canonical'

export interface ObservationInput {
  txHash: string
  region: string
  firstSeen: number
  seenBlock: number
  fromUncle: boolean
  signature: string
}

/**
 * Listener signers allowed to write observations. ALLOWED_LISTENER_ADDRESSES
 * (comma-separated) is the multi-region production allowlist; when unset, the
 * address derived from LISTENER_PK is used as the sole allowed signer — a
 * reasonable single-region dev default, insufficient for the real two-region
 * deployment (document this in ops config before going live).
 */
export function allowedListeners(env: Env): Set<string> {
  const set = new Set<string>()
  if (env.ALLOWED_LISTENER_ADDRESSES) {
    for (const raw of env.ALLOWED_LISTENER_ADDRESSES.split(',')) {
      const addr = raw.trim().toLowerCase()
      if (addr) set.add(addr)
    }
  }
  if (env.LISTENER_PK) {
    set.add(privateKeyToAccount(env.LISTENER_PK as Hex).address.toLowerCase())
  }
  return set
}

export interface VerifyResult {
  ok: boolean
  signer?: Hex
}

export async function verifyObservation(body: ObservationInput, env: Env): Promise<VerifyResult> {
  const message = canonicalObservation(body)
  let signer: Hex
  try {
    signer = await recoverMessageAddress({ message, signature: body.signature as Hex })
  } catch {
    return { ok: false }
  }

  const allowed = allowedListeners(env)
  if (allowed.size === 0) return { ok: false } // fail closed: nothing configured, trust nobody
  if (!allowed.has(signer.toLowerCase())) return { ok: false }
  return { ok: true, signer }
}

export interface IngestResult {
  stored: boolean
  probeId?: number
  reason?: string
}

export function ingestObservation(stmts: Statements, body: ObservationInput, signer: Hex): IngestResult {
  const probe = stmts.getProbeByTxHash.get(body.txHash) as { id: number } | null
  if (!probe) return { stored: false, reason: 'no probe tracks this tx hash' }

  stmts.insertObservation.run(
    probe.id,
    body.region,
    body.txHash,
    body.firstSeen,
    body.seenBlock,
    body.fromUncle ? 1 : 0,
    body.signature,
    signer,
  )
  return { stored: true, probeId: probe.id }
}
