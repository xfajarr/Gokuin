// Canonical message signed over (txHash, firstSeen, region, seenBlock).
// KEEP THIS BYTE-IDENTICAL to apps/api/src/observe/canonical.ts, the API
// recovers the signer from exactly this string, this process signs exactly
// this string. Duplicated intentionally: this task's scope is apps/api +
// apps/listener only, and this glue is protocol-level, not one of the metric
// definitions that must live solely in @gokuin/core.
export interface CanonicalObservationInput {
  txHash: string
  region: string
  firstSeen: number
  seenBlock: number
}

export function canonicalObservation(p: CanonicalObservationInput): string {
  return `gokuin.observation:${p.txHash.toLowerCase()}:${p.region}:${p.firstSeen}:${p.seenBlock}`
}
