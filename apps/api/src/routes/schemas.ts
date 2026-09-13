// TypeBox response schemas mirroring the shapes of @gokuin/core's types.
// These validate/serialize API responses; they do not redefine any metric :
// the numbers themselves always come from core functions or subgraph reads.
import { t } from 'elysia'

export const RouteScore = t.Object({
  route: t.String(),
  probes: t.Number(),
  leaks: t.Number(),
  leakBps: t.Number(),
  sandwiches: t.Number(),
  sandwichBps: t.Number(),
  medianDelayBlocks: t.Number(),
  totalExtractedWei: t.String(),
  lastCycle: t.Number(),
})

export const EvidenceItem = t.Object({
  txHash: t.String(),
  what: t.String(),
})

export const Selection = t.Object({
  route: t.String(),
  reason: t.String(),
  evidence: t.Array(EvidenceItem),
  runnerUp: t.Union([t.String(), t.Null()]),
})
