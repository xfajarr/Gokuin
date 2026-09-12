// Typed environment for apps/api. Sources exactly the variables declared in the
// repo-root /.env.example, plus a handful of optional extensions (documented
// below) that are needed to make chain/routes.ts and observe/ingest.ts real
// rather than stubbed. Everything that gates a live chain call is optional:
// when it is absent the relevant module runs in a clearly-labelled fixture /
// dry-run mode instead of skipping the code path.
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const EnvSchema = Type.Object({
  // --- from /.env.example ---
  MAINNET_RPC: Type.String({ default: 'http://127.0.0.1:8545' }),
  MAINNET_WS: Type.Optional(Type.String()),
  SEPOLIA_RPC: Type.String({ default: 'http://127.0.0.1:8545' }),
  PROBER_PK: Type.Optional(Type.String()),
  SCORER_PK: Type.Optional(Type.String()),
  LISTENER_PK: Type.Optional(Type.String()),
  LISTENER_REGION: Type.String({ default: 'eu-central' }),
  API_URL: Type.String({ default: 'http://localhost:3000' }),
  API_ADMIN_TOKEN: Type.Optional(Type.String()),
  SUBGRAPH_URL: Type.Optional(Type.String()),
  PROBE_LEDGER_ADDRESS: Type.Optional(Type.String()),
  ROUTE_REGISTRY_ADDRESS: Type.Optional(Type.String()),
  SCORER_ADDRESS: Type.Optional(Type.String()),

  // --- extensions beyond .env.example (all optional / all with safe defaults) ---
  // Comma-separated allowlist of listener signer addresses. When absent, the
  // address derived from LISTENER_PK is used as the sole allowed signer — fine
  // for a single-region dev setup, insufficient for the real two-region deploy.
  ALLOWED_LISTENER_ADDRESSES: Type.Optional(Type.String()),
  // Public RPC endpoints for the two protected routes. These are not secrets.
  FLASHBOTS_PROTECT_RPC: Type.String({ default: 'https://rpc.flashbots.net/fast' }),
  MEV_BLOCKER_RPC: Type.String({ default: 'https://rpc.mevblocker.io' }),
  DB_PATH: Type.String({ default: 'gokuin.db' }),
  PORT: Type.Number({ default: 3000 }),
})

export type Env = Static<typeof EnvSchema>

let cached: Env | undefined

/** Loads and validates env once per process. Pass a source map in tests. */
export function loadEnv(source: Record<string, string | undefined> = Bun.env as any): Env {
  if (cached) return cached
  const raw: Record<string, unknown> = {}
  for (const key of Object.keys(EnvSchema.properties)) {
    const v = source[key]
    if (v !== undefined && v !== '') raw[key] = key === 'PORT' ? Number(v) : v
  }
  const withDefaults = Value.Default(EnvSchema, raw) as Env
  if (!Value.Check(EnvSchema, withDefaults)) {
    const errors = [...Value.Errors(EnvSchema, withDefaults)]
    throw new Error(`Invalid environment: ${errors.map(e => `${e.path} ${e.message}`).join('; ')}`)
  }
  cached = withDefaults
  return withDefaults
}

/** Test-only: forces the next loadEnv() call to re-read process.env. */
export function resetEnvCache() {
  cached = undefined
}
