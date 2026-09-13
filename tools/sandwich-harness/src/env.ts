// Env for the standalone harness. Reads the repo-root .env (this tool lives
// at tools/sandwich-harness, two levels below repo root) — the same file
// apps/api and apps/listener read, so there is exactly one SEPOLIA_RPC and
// one set of keys for the whole project, not a second copy that could drift.
//
// Note what is NOT here: there is no env var that changes which chain this
// targets (see guards/chain-guard.ts) and no env var that authorizes a
// victim address (see guards/victim-guard.ts). SEPOLIA_RPC only says where to
// ask; the chain guard independently verifies what it's actually talking to.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface HarnessEnv {
  sepoliaRpc: string
  /** Attacker/setup broadcasting key. Falls back to DEPLOYER_PK, then PROBER_PK — both hold the same Sepolia testnet ETH per repo-root .env. */
  operatorPk: `0x${string}`
  /** The prober's own key — used only to prove the victim probe belongs to us; never used to sign the attack legs. */
  proberPk?: `0x${string}`
  proberAddress?: `0x${string}`
  dbPath: string
}

function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, '.env')) || existsSync(join(dir, 'PRD.md'))) return dir
    dir = dirname(dir)
  }
  return startDir
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

let cached: HarnessEnv | undefined

export function loadHarnessEnv(): HarnessEnv {
  if (cached) return cached
  const repoRoot = findRepoRoot(process.cwd())
  const envPath = join(repoRoot, '.env')
  const fromFile = existsSync(envPath) ? parseDotenv(readFileSync(envPath, 'utf8')) : {}
  const source = { ...fromFile, ...process.env } as Record<string, string | undefined>

  const sepoliaRpc = source.SEPOLIA_RPC
  if (!sepoliaRpc) {
    throw new Error('SEPOLIA_RPC is not set in the repo-root .env — cannot run without a Sepolia RPC endpoint.')
  }

  const operatorPk = (source.DEPLOYER_PK || source.PROBER_PK) as `0x${string}` | undefined
  if (!operatorPk) {
    throw new Error('Neither DEPLOYER_PK nor PROBER_PK is set — need a funded Sepolia key to run the harness for real.')
  }

  cached = {
    sepoliaRpc,
    operatorPk,
    proberPk: source.PROBER_PK as `0x${string}` | undefined,
    proberAddress: source.PROBER_ADDRESS as `0x${string}` | undefined,
    dbPath: join(repoRoot, 'apps', 'api', 'gokuin.db'),
  }
  return cached
}

export function resetHarnessEnvCache() {
  cached = undefined
}

export function repoRootFromHere(): string {
  return findRepoRoot(process.cwd())
}
