// Typed env for the standalone listener process (PRD §7.4). Deployed twice,
// once per region — LISTENER_REGION is the only thing that differs between
// the two deployments.
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const EnvSchema = Type.Object({
  MAINNET_RPC: Type.String({ default: 'http://127.0.0.1:8545' }),
  MAINNET_WS: Type.Optional(Type.String()),
  LISTENER_PK: Type.Optional(Type.String()),
  LISTENER_REGION: Type.String({ default: 'eu-central' }),
  API_URL: Type.String({ default: 'http://localhost:3000' }),
  // Extensions beyond .env.example, all optional with safe defaults:
  POLL_INTERVAL_MS: Type.Number({ default: 4000 }),
  WATCHLIST_REFRESH_MS: Type.Number({ default: 15000 }),
  // Explicit override; otherwise fixture mode is auto-entered when MAINNET_WS is absent.
  FIXTURE_MODE: Type.Optional(Type.String()),
})

export type Env = Static<typeof EnvSchema>

let cached: Env | undefined

export function loadEnv(source: Record<string, string | undefined> = Bun.env as any): Env {
  if (cached) return cached
  const raw: Record<string, unknown> = {}
  for (const key of Object.keys(EnvSchema.properties)) {
    const v = source[key]
    if (v !== undefined && v !== '') raw[key] = key.endsWith('_MS') ? Number(v) : v
  }
  const withDefaults = Value.Default(EnvSchema, raw) as Env
  if (!Value.Check(EnvSchema, withDefaults)) {
    const errors = [...Value.Errors(EnvSchema, withDefaults)]
    throw new Error(`Invalid environment: ${errors.map(e => `${e.path} ${e.message}`).join('; ')}`)
  }
  cached = withDefaults
  return withDefaults
}

export function resetEnvCache() {
  cached = undefined
}
