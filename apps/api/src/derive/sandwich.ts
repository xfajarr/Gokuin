// The sandwich verdict for one probe, read from the Substreams module itself.
//
// This used to query a substreams-powered subgraph. That architecture is gone :
// The Graph's Studio now rejects it outright: "Substreams-powered Subgraphs,
// originally intended for non-EVM chains, are no longer supported." So the module
// is consumed standalone, from the published package:
//
//   https://substreams.dev/packages/sandwich-detect/v0.1.0
//
// The Graph stays load-bearing in exactly the way it was: without a Substreams
// endpoint there is no verdict, and without a verdict no row is written. Two
// cases used to both return `sandwiched: false`, and only one of them is honest:
//
//   module ran, found no triple  -> we looked and there was none. A measurement.
//   no endpoint configured       -> we never looked. Writing `false` would
//                                   fabricate a clean record for a named
//                                   company's route, and the row is permanent.
//
// The second throws. A probe with no verdict gets no Row, the cycle's published
// count falls short of its committed count, and integrity reports false, the
// honest outcome. A measurement we could not take should cost us our own
// integrity score, not be papered over as someone else's clean route.
//
// Only the probe's own inclusion block is streamed (`-s block -t +1`), so a
// verdict costs one block of processing rather than a scan.
import type { Hex } from 'viem'
import type { SandwichVerdict } from '@gokuin/core'
import type { Env } from '../env'
import {
  createRegistry,
  createRequest,
  fetchSubstream,
  isEmptyMessage,
  streamBlocks,
  unpackMapOutput,
} from '@substreams/core'
import { createNodeTransport } from '@substreams/node/createNodeTransport'

const MODULE = 'map_sandwiches'

/** No verdict could be obtained. Settlement must not invent one. */
export class SandwichVerdictUnavailable extends Error {
  constructor(
    readonly victimTxHash: Hex,
    reason: string,
  ) {
    super(
      `no sandwich verdict for ${victimTxHash}: ${reason}. ` +
        `Refusing to record a row claiming the route was clean when we did not look.`,
    )
    this.name = 'SandwichVerdictUnavailable'
  }
}

interface SandwichItem {
  victimTxHash: string
  pool: string
  victim: string
  frontrunTx: string
  backrunTx: string
  attacker: string
  attackerRoundTripWei: string
  detectedBy: string
}

/**
 * @param includedBlock the block the probe landed in. Streaming exactly this one
 *        block is what keeps a verdict cheap; the module itself is generic and
 *        would happily scan the chain.
 */
export async function fetchSandwichVerdict(
  env: Env,
  victimTxHash: Hex,
  includedBlock: number,
): Promise<SandwichVerdict> {
  if (!env.SUBSTREAMS_PACKAGE || !env.SUBSTREAMS_ENDPOINT) {
    throw new SandwichVerdictUnavailable(
      victimTxHash,
      'SUBSTREAMS_PACKAGE or SUBSTREAMS_ENDPOINT is not configured',
    )
  }
  if (!env.SUBSTREAMS_API_KEY) {
    throw new SandwichVerdictUnavailable(victimTxHash, 'SUBSTREAMS_API_KEY is not configured')
  }

  const pkg = await fetchSubstream(env.SUBSTREAMS_PACKAGE)
  const registry = createRegistry(pkg)
  // createNodeTransport's 4th parameter is Headers, not interceptors, the auth
  // token is the 2nd argument and the transport attaches it itself.
  const transport = createNodeTransport(env.SUBSTREAMS_ENDPOINT, env.SUBSTREAMS_API_KEY, registry)
  const request = createRequest({
    substreamPackage: pkg,
    outputModule: MODULE,
    startBlockNum: BigInt(includedBlock),
    stopBlockNum: `+1`,
  })

  const wanted = victimTxHash.toLowerCase()
  for await (const response of streamBlocks(transport, request)) {
    const output = unpackMapOutput(response, registry)
    if (output === undefined || isEmptyMessage(output)) continue
    const items = (output.toJson({ typeRegistry: registry }) as { items?: SandwichItem[] }).items ?? []
    const hit = items.find(i => i.victimTxHash.toLowerCase() === wanted)
    if (hit) {
      return {
        sandwiched: true,
        frontrunHash: hit.frontrunTx as Hex,
        backrunHash: hit.backrunTx as Hex,
        attacker: hit.attacker as Hex,
        moduleVersion: hit.detectedBy,
      }
    }
  }

  // The module ran over the probe's own block and found no triple around it.
  // This false is a measurement, not an assumption, that distinction is the
  // whole reason the unconfigured case above throws instead of landing here.
  return { sandwiched: false, moduleVersion: `${MODULE}@${env.SUBSTREAMS_PACKAGE}` }
}
