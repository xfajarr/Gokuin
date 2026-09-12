// Route registry: name -> transport + capabilities. Each route is an RPC
// endpoint a raw signed transaction can be submitted to; "public-mempool" is
// just the mainnet node itself (no privacy claim), the other two are the
// protected relays under test. One http transport per route, per PRD §7.1.
import { http, type Transport } from 'viem'
import { ROUTE_IDS, ROUTES, type RouteId } from '@gokuin/core'
import type { Env } from '../env'
import { isFixtureRpc } from './clients'

export interface RouteDef {
  id: RouteId
  routeId: number
  rpcUrl: string
  transport: Transport
  capabilities: { private: boolean; bundled: boolean }
  /** true when this route's rpcUrl is the local fixture default, not a live relay. */
  dryRun: boolean
}

const CAPABILITIES: Record<RouteId, { private: boolean; bundled: boolean }> = {
  'public-mempool': { private: false, bundled: false },
  'flashbots-protect': { private: true, bundled: true },
  'mev-blocker': { private: true, bundled: false },
}

export function buildRouteRegistry(env: Env): Record<RouteId, RouteDef> {
  const urls: Record<RouteId, string> = {
    'public-mempool': env.MAINNET_RPC,
    'flashbots-protect': env.FLASHBOTS_PROTECT_RPC,
    'mev-blocker': env.MEV_BLOCKER_RPC,
  }
  const registry = {} as Record<RouteId, RouteDef>
  for (const id of ROUTES) {
    const rpcUrl = urls[id]
    registry[id] = {
      id,
      routeId: ROUTE_IDS[id],
      rpcUrl,
      transport: http(rpcUrl),
      capabilities: CAPABILITIES[id],
      dryRun: isFixtureRpc(rpcUrl),
    }
  }
  return registry
}
