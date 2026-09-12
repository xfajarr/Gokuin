// bun:sqlite — operational, off-chain store. Schema is the exact DDL from
// PRD.md §5. This is metadata only: scores are read from the Subgraph
// (see src/score/read.ts), never from these tables.
import { Database } from 'bun:sqlite'

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cycle (
  id            INTEGER PRIMARY KEY,
  schedule_hash TEXT NOT NULL,
  salt          TEXT,                 -- null until reveal
  probe_count   INTEGER NOT NULL,
  committed_at  INTEGER NOT NULL,     -- unix ms
  committed_tx  TEXT NOT NULL,        -- sepolia tx
  revealed_at   INTEGER,
  revealed_tx   TEXT
);

CREATE TABLE IF NOT EXISTS probe (
  id              INTEGER PRIMARY KEY,
  cycle_id        INTEGER NOT NULL REFERENCES cycle(id),
  route           TEXT NOT NULL,      -- 'public-mempool' | 'flashbots-protect' | 'mev-blocker'
  twin_group      TEXT NOT NULL,      -- uuid shared by the pair
  from_address    TEXT NOT NULL,      -- single-use EOA
  tx_hash         TEXT,               -- mainnet
  pool            TEXT NOT NULL,
  amount_in_wei   TEXT NOT NULL,
  slippage_bps    INTEGER NOT NULL,
  submitted_block INTEGER,
  submitted_at    INTEGER,
  included_block  INTEGER,
  status          TEXT NOT NULL       -- pending|included|dropped|reverted
);

CREATE TABLE IF NOT EXISTS observation (
  id          INTEGER PRIMARY KEY,
  probe_id    INTEGER NOT NULL REFERENCES probe(id),
  region      TEXT NOT NULL,          -- 'eu-central' | 'us-east'
  tx_hash     TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,       -- unix ms
  seen_block  INTEGER NOT NULL,       -- head at observation
  from_uncle  INTEGER NOT NULL DEFAULT 0,
  signature   TEXT NOT NULL,          -- listener key over (txHash, firstSeen, region)
  signer      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS derivation (
  probe_id      INTEGER PRIMARY KEY REFERENCES probe(id),
  sim_out       TEXT NOT NULL,
  real_out      TEXT NOT NULL,
  extracted_wei TEXT NOT NULL,
  sandwiched    INTEGER NOT NULL,
  frontrun_hash TEXT,
  backrun_hash  TEXT,
  leaked        INTEGER NOT NULL,
  leaked_at     INTEGER,
  module_version TEXT NOT NULL,
  ledger_tx     TEXT                  -- sepolia record() tx
);

-- Extends PRD §5's data model: per-probe funding + sweep accounting
-- (chain/distributor.ts). Every probe must have a traceable cost — this
-- table is that trace: what it was funded, why (gas budget), and what came
-- back on sweep (or why nothing did).
CREATE TABLE IF NOT EXISTS funding (
  id                INTEGER PRIMARY KEY,
  probe_id          INTEGER NOT NULL REFERENCES probe(id),
  funding_tx        TEXT NOT NULL,      -- distributor -> probe transfer (real tx, or dry-run stand-in hash)
  amount_wei        TEXT NOT NULL,      -- total funded: swap value + gas budget + per-probe jitter
  gas_budget_wei    TEXT NOT NULL,      -- the gas-only portion of amount_wei
  funded_at         INTEGER NOT NULL,   -- unix ms
  sweep_tx          TEXT,               -- probe -> distributor sweep transfer; NULL until swept or dust-skipped
  swept_amount_wei  TEXT,               -- amount actually recovered; NULL until swept
  swept_at          INTEGER,            -- unix ms
  dust_skipped      INTEGER NOT NULL DEFAULT 0  -- 1 = leftover left in place rather than burning gas to move it
);

CREATE INDEX IF NOT EXISTS idx_probe_cycle ON probe(cycle_id);
CREATE INDEX IF NOT EXISTS idx_obs_probe   ON observation(probe_id);
CREATE INDEX IF NOT EXISTS idx_funding_probe ON funding(probe_id);
`

export function openDb(path: string): Database {
  const db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA_SQL)
  return db
}

export function createStatements(db: Database) {
  return {
    insertCycle: db.prepare(
      `INSERT INTO cycle (id, schedule_hash, salt, probe_count, committed_at, committed_tx)
       VALUES (?, ?, NULL, ?, ?, ?)`,
    ),
    revealCycle: db.prepare(
      `UPDATE cycle SET salt = ?, revealed_at = ?, revealed_tx = ? WHERE id = ?`,
    ),
    getCycle: db.prepare(`SELECT * FROM cycle WHERE id = ?`),

    insertProbe: db.prepare(
      `INSERT INTO probe (cycle_id, route, twin_group, from_address, pool, amount_in_wei, slippage_bps, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ),
    updateProbeSubmitted: db.prepare(
      `UPDATE probe SET tx_hash = ?, submitted_block = ?, submitted_at = ? WHERE id = ?`,
    ),
    updateProbeIncluded: db.prepare(
      `UPDATE probe SET included_block = ?, status = 'included' WHERE id = ?`,
    ),
    updateProbeStatus: db.prepare(`UPDATE probe SET status = ? WHERE id = ?`),
    getProbe: db.prepare(`SELECT * FROM probe WHERE id = ?`),
    getProbesByCycle: db.prepare(`SELECT * FROM probe WHERE cycle_id = ?`),
    getProbesByTwinGroup: db.prepare(`SELECT * FROM probe WHERE twin_group = ?`),
    getProbeByTxHash: db.prepare(`SELECT * FROM probe WHERE tx_hash = ?`),
    getPendingProbeTxHashes: db.prepare(
      `SELECT tx_hash FROM probe WHERE status = 'pending' AND tx_hash IS NOT NULL AND route != 'public-mempool'`,
    ),

    insertObservation: db.prepare(
      `INSERT INTO observation (probe_id, region, tx_hash, first_seen, seen_block, from_uncle, signature, signer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    getObservationsByProbe: db.prepare(`SELECT * FROM observation WHERE probe_id = ?`),

    insertDerivation: db.prepare(
      `INSERT INTO derivation (probe_id, sim_out, real_out, extracted_wei, sandwiched, frontrun_hash, backrun_hash, leaked, leaked_at, module_version, ledger_tx)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    getDerivation: db.prepare(`SELECT * FROM derivation WHERE probe_id = ?`),

    insertFunding: db.prepare(
      `INSERT INTO funding (probe_id, funding_tx, amount_wei, gas_budget_wei, funded_at)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    recordSweep: db.prepare(
      `UPDATE funding SET sweep_tx = ?, swept_amount_wei = ?, swept_at = ?, dust_skipped = ? WHERE probe_id = ?`,
    ),
    getFundingByProbe: db.prepare(`SELECT * FROM funding WHERE probe_id = ?`),
    getFundingByCycle: db.prepare(
      `SELECT funding.* FROM funding JOIN probe ON probe.id = funding.probe_id WHERE probe.cycle_id = ?`,
    ),
  }
}

export type Statements = ReturnType<typeof createStatements>
