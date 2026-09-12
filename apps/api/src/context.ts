// Shared application context, built once at startup and threaded through the
// route modules. Keeping this as plain DI (no framework magic) makes every
// piece independently testable.
import type { Database } from 'bun:sqlite'
import type { PublicClient, WalletClient } from 'viem'
import type { RouteId } from '@gokuin/core'
import type { Env } from './env'
import type { Statements } from './db'
import type { RouteDef } from './chain/routes'
import type { ProbeLedgerClient } from './chain/ledger'
import type { DistributorClient } from './chain/distributor'
import type { ScoreReader } from './score/read'
import type { Selector } from './score/select'

export interface AppContext {
  env: Env
  db: Database
  stmts: Statements
  mainnetPublic: PublicClient
  sepoliaPublic: PublicClient
  sepoliaWallet: WalletClient | null
  routeRegistry: Record<RouteId, RouteDef>
  ledger: ProbeLedgerClient
  distributor: DistributorClient
  scoreReader: ScoreReader
  selector: Selector
}
