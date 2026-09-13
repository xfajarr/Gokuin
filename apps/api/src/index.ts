// Elysia app: plugin composition, .listen(). Exports `App` for Eden Treaty
// (apps/web, apps/mcp import this type for end-to-end types, no codegen :
// PRD §7.5).
import { Elysia } from 'elysia'
import { loadEnv } from './env'
import { openDb, createStatements } from './db'
import { makeMainnetPublicClient, makeSepoliaPublicClient, makeSepoliaWalletClient } from './chain/clients'
import { buildRouteRegistry } from './chain/routes'
import { createLedgerClient } from './chain/ledger'
import { createDistributorClient } from './chain/distributor'
import { createScoreReader } from './score/read'
import { createSelector } from './score/select'
import { createPublicRoutes } from './routes/public'
import { createListenerRoutes } from './routes/listener'
import { createAdminRoutes } from './routes/admin'
import type { AppContext } from './context'

const env = loadEnv()
const db = openDb(env.DB_PATH)
const stmts = createStatements(db)

const mainnetPublic = makeMainnetPublicClient(env)
const sepoliaPublic = makeSepoliaPublicClient(env)
const sepoliaWallet = makeSepoliaWalletClient(env)
const routeRegistry = buildRouteRegistry(env)
const ledger = createLedgerClient(env, sepoliaWallet, sepoliaPublic)
const distributor = createDistributorClient(env, mainnetPublic)
const scoreReader = createScoreReader(env)
const selector = createSelector(scoreReader)

export const ctx: AppContext = {
  env,
  db,
  stmts,
  mainnetPublic,
  sepoliaPublic,
  sepoliaWallet,
  routeRegistry,
  ledger,
  distributor,
  scoreReader,
  selector,
}

export const app = new Elysia()
  .use(createPublicRoutes(ctx))
  .use(createListenerRoutes(ctx))
  .use(createAdminRoutes(ctx))
  .get('/health', () => ({
    ok: true,
    ledgerDryRun: ledger.dryRun,
    distributorDryRun: distributor.dryRun,
    subgraphConfigured: Boolean(env.SUBGRAPH_URL),
  }))

// Only bind a real port when this file is the entrypoint, importing it from
// tests must not start a listening server.
if (import.meta.main) {
  app.listen(env.PORT, () => {
    console.log(
      `gokuin api listening on :${env.PORT}` +
        (ledger.dryRun ? ' [ledger dry-run: no PROBER_PK/PROBE_LEDGER_ADDRESS configured]' : '') +
        (distributor.dryRun ? ' [distributor dry-run: no DISTRIBUTOR_PK configured]' : '') +
        (env.SUBGRAPH_URL ? '' : ' [no SUBGRAPH_URL: /v1/routes* will 503]'),
    )
  })
}

export type App = typeof app
export default app
