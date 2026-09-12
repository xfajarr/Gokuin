// Typed environment for the Gokuin MCP harness.
// Mirrors the variable names in the repo root .env.example (API_URL) and adds
// the route-transport RPC endpoints this app owns.

export interface RouteTransportConfig {
  /** JSON-RPC endpoint that accepts eth_sendRawTransaction for this route. */
  rpcUrl: string
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

export const env = {
  /** Base URL of the Gokuin API (apps/api). Same variable name used repo-wide. */
  apiUrl: trimTrailingSlash(process.env.API_URL ?? 'http://localhost:3000'),

  /** Optional bearer token if the API is deployed behind auth. */
  apiToken: process.env.API_TOKEN,

  /** How long to wait for the API before giving up and reporting it unavailable. */
  apiTimeoutMs: Number(process.env.API_TIMEOUT_MS ?? 8000),

  /** 'stdio' (default, for Claude Code / Cursor) or 'http' (hosted). */
  transport: (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase(),

  /** Port for the HTTP transport. */
  httpPort: Number(process.env.MCP_HTTP_PORT ?? 8787),

  /** Host to bind the HTTP transport to. */
  httpHost: process.env.MCP_HTTP_HOST ?? '0.0.0.0',
} as const

/**
 * Per-route JSON-RPC endpoints that will accept a raw signed transaction.
 * These are separate from the Gokuin API — submission goes straight to the
 * route's own transport, exactly as a probe would send it. Overridable per
 * deployment; the defaults are the routes' own public endpoints.
 */
export const ROUTE_RPC_URLS: Record<string, string> = {
  'public-mempool': process.env.PUBLIC_MEMPOOL_RPC_URL ?? process.env.MAINNET_RPC ?? 'https://cloudflare-eth.com',
  'flashbots-protect': process.env.FLASHBOTS_PROTECT_RPC_URL ?? 'https://rpc.flashbots.net',
  'mev-blocker': process.env.MEV_BLOCKER_RPC_URL ?? 'https://rpc.mevblocker.io',
}
