// GraphQL query against the Substreams-powered subgraph for the sandwich
// verdict on one probe's tx hash (PRD §5 `Sandwich` entity, §11 definition).
// Subgraph is load-bearing for scores (score/read.ts) but for the sandwich
// *derivation* used to compose a Row, a missing subgraph degrades to a
// clearly-labelled fixture verdict rather than blocking settlement entirely —
// the row still needs a (possibly "unknown") sandwich flag to be written once.
import type { Hex } from 'viem'
import type { SandwichVerdict } from '@gokuin/core'
import type { Env } from '../env'

const QUERY = `query($id: ID!) {
  sandwich(id: $id) {
    id block pool victim frontrunTx backrunTx attacker attackerRoundTripWei detectedBy
  }
}`

export async function fetchSandwichVerdict(env: Env, victimTxHash: Hex): Promise<SandwichVerdict> {
  if (!env.SUBGRAPH_URL) {
    console.warn('[derive:sandwich] SUBGRAPH_URL not configured — fixture verdict (not sandwiched)')
    return { sandwiched: false, moduleVersion: 'fixture-no-subgraph' }
  }

  const res = await fetch(env.SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { id: victimTxHash.toLowerCase() } }),
  })
  if (!res.ok) throw new Error(`subgraph responded ${res.status}`)
  const json = (await res.json()) as { data?: { sandwich?: any }; errors?: unknown }
  if (json.errors) throw new Error(`subgraph error: ${JSON.stringify(json.errors)}`)

  const s = json.data?.sandwich
  if (!s) return { sandwiched: false, moduleVersion: 'sandwich-detect' }

  return {
    sandwiched: true,
    frontrunHash: s.frontrunTx as Hex,
    backrunHash: s.backrunTx as Hex,
    attacker: s.attacker as Hex,
    moduleVersion: s.detectedBy,
  }
}
