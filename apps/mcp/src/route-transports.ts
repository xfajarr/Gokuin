// Submits a raw, already-signed transaction through the JSON-RPC endpoint that
// backs a given route. Gokuin never holds keys and never builds transactions :
// the caller signs, we send it down the route their `need` selected.

import { createPublicClient, http, type Hash } from 'viem'
import { mainnet } from 'viem/chains'
import type { RouteId } from '@gokuin/core'
import { ROUTES } from '@gokuin/core'
import { ROUTE_RPC_URLS } from './env'

export class RouteTransportError extends Error {
  constructor(readonly reason: string, readonly cause?: unknown) {
    super(reason)
    this.name = 'RouteTransportError'
  }
}

function isRouteId(value: string): value is RouteId {
  return (ROUTES as readonly string[]).includes(value)
}

/**
 * Sends `rawTx` (0x-prefixed signed transaction hex) through the transport for
 * `route`. Returns the mainnet transaction hash the network assigned it.
 */
export async function submitViaRoute(route: RouteId, rawTx: string): Promise<Hash> {
  if (!isRouteId(route)) {
    throw new RouteTransportError(
      `Unknown route "${route}". Known routes: ${ROUTES.join(', ')}. Refusing to submit somewhere unmeasured.`,
    )
  }

  const rpcUrl = ROUTE_RPC_URLS[route]
  if (!rpcUrl) {
    throw new RouteTransportError(
      `No RPC endpoint configured for route "${route}". Set its *_RPC_URL environment variable.`,
    )
  }

  if (!/^0x[0-9a-fA-F]+$/.test(rawTx)) {
    throw new RouteTransportError('tx must be a 0x-prefixed hex string of a signed, raw transaction.')
  }

  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })

  try {
    return await client.sendRawTransaction({ serializedTransaction: rawTx as `0x${string}` })
  } catch (err) {
    throw new RouteTransportError(
      `Submitting through route "${route}" (${rpcUrl}) failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }
}
