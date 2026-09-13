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
  // Distributor account that funds each freshly-rotated probe EOA and sweeps
  // its leftover back after settlement (see chain/distributor.ts). Absent ->
  // dry-run: real fee estimation and real signing happen where a key exists
  // (sweep, signed by the probe's own key), but funding/sweep broadcasts are
  // skipped and preflight balance checks are skipped rather than hard-failing
  // every dev/dry-run cycle.
  DISTRIBUTOR_PK: Type.Optional(Type.String()),

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
  /** The published Substreams package the sandwich verdict comes from.
   *  Consumed by reference, so the detector a judge runs is the detector we run:
   *  https://substreams.dev/packages/sandwich-detect/v0.1.0 */
  SUBSTREAMS_PACKAGE: Type.Optional(Type.String()),
  SUBSTREAMS_ENDPOINT: Type.Optional(Type.String()),
  SUBSTREAMS_API_KEY: Type.Optional(Type.String()),
  /** Hard lifetime ceiling on real spend. Enforced in chain/budget.ts, not by intent.
   *  A decimal STRING, parsed with parseEther — float arithmetic loses wei. */
  PROBE_BUDGET_ETH: Type.String({ default: '0.004' }),
  /** Refuse to dispatch above this. Gas has moved 500x before; a spike must not
   *  be allowed to consume the whole budget in one cycle. Decimal string, parseGwei. */
  MAX_GAS_PRICE_GWEI: Type.String({ default: '2' }),

  // Distributor funding tuning (chain/distributor.ts). All have safe
  // defaults; a real deployment should set the delay knobs above zero so
  // fundings don't land back-to-back in the same block window (PRD §18).
  FUNDING_GAS_HEADROOM_MULTIPLIER: Type.Number({ default: 1.5 }),
  FUNDING_AMOUNT_JITTER_BPS: Type.Number({ default: 250 }),
  FUNDING_MIN_DELAY_MS: Type.Number({ default: 0 }),
  FUNDING_JITTER_DELAY_MS: Type.Number({ default: 0 }),
  SWEEP_GAS_BUFFER_MULTIPLIER: Type.Number({ default: 1.2 }),
})

export type Env = Static<typeof EnvSchema>

let cached: Env | undefined

/** Loads and validates env once per process. Pass a source map in tests. */
const NUMERIC_KEYS = new Set([
  'PORT',
  'FUNDING_GAS_HEADROOM_MULTIPLIER',
  'FUNDING_AMOUNT_JITTER_BPS',
  'FUNDING_MIN_DELAY_MS',
  'FUNDING_JITTER_DELAY_MS',
  'SWEEP_GAS_BUFFER_MULTIPLIER',
])

export function loadEnv(source: Record<string, string | undefined> = Bun.env as any): Env {
  if (cached) return cached
  const raw: Record<string, unknown> = {}
  for (const key of Object.keys(EnvSchema.properties)) {
    const v = source[key]
    if (v !== undefined && v !== '') raw[key] = NUMERIC_KEYS.has(key) ? Number(v) : v
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
