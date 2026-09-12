// GraphQL query against the Substreams-powered subgraph for the sandwich
// verdict on one probe's tx hash (PRD §5 `Sandwich` entity, §11 definition).
// The subgraph is load-bearing here in exactly the way it is for scores. Two
// cases both used to return `sandwiched: false`, and only one of them is honest:
//
//   no subgraph configured  -> we did not look. Writing `false` is a fabricated
//                              claim, and the row is permanent.
//   subgraph says no match  -> we looked and there was none. `false` is correct.
//
// So the first case throws. A probe with no verdict does not get a Row, and the
// cycle's published count falls short of its committed count — which is the
// honest outcome: a measurement we could not take should cost us our own
// integrity score, not be papered over with a clean flag on someone else's
// route.
import type { Hex } from 'viem'
import type { SandwichVerdict } from '@gokuin/core'
import type { Env } from '../env'

const QUERY = `query($id: ID!) {
  sandwich(id: $id) {
    id block pool victim frontrunTx backrunTx attacker attackerRoundTripWei detectedBy
  }
}`

/** No verdict could be obtained. Settlement must not invent one. */
export class SandwichVerdictUnavailable extends Error {
  constructor(readonly victimTxHash: Hex) {
    super(
      `no sandwich verdict for ${victimTxHash}: SUBGRAPH_URL is not configured. ` +
        `Refusing to record a row claiming the route was clean when we did not look.`,
    )
    this.name = 'SandwichVerdictUnavailable'
  }
}

export async function fetchSandwichVerdict(env: Env, victimTxHash: Hex): Promise<SandwichVerdict> {
  if (!env.SUBGRAPH_URL) throw new SandwichVerdictUnavailable(victimTxHash)

  const res = await fetch(env.SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { id: victimTxHash.toLowerCase() } }),
  })
  if (!res.ok) throw new Error(`subgraph responded ${res.status}`)
  const json = (await res.json()) as { data?: { sandwich?: any }; errors?: unknown }
  if (json.errors) throw new Error(`subgraph error: ${JSON.stringify(json.errors)}`)

  const s = json.data?.sandwich
  // looked and found none — this false is a measurement, not an assumption
  if (!s) return { sandwiched: false, moduleVersion: 'sandwich-detect' }

  return {
    sandwiched: true,
    frontrunHash: s.frontrunTx as Hex,
    backrunHash: s.backrunTx as Hex,
    attacker: s.attacker as Hex,
    moduleVersion: s.detectedBy,
  }
}
