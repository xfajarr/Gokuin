// A hard ceiling on what Gokuin may ever spend.
//
// The operator's constraint is a real one: this is a hackathon, not a funded
// desk, and mainnet gas moved 500x within living memory. A budget that lives in
// someone's intention is not a budget — the first gas spike drains the wallet
// while nobody is watching a 3am cron.
//
// Two independent brakes, because they fail differently:
//
//   spend cap   — cumulative, read from what has actually been spent on chain.
//                 Survives restarts, because it is derived from the funding
//                 ledger rather than a counter in memory.
//   gas ceiling — refuses to dispatch at all above a set gas price. Stops a
//                 spike from consuming the whole remaining budget in one cycle.
//
// The spend cap alone is not enough: it would happily let a single 400 gwei
// cycle eat the lot. The gas ceiling alone is not enough either: a thousand
// cheap cycles still add up.
import { parseEther, parseGwei, type PublicClient } from 'viem'
import type { Statements } from '../db'
import type { Env } from '../env'

export class BudgetExceeded extends Error {
  constructor(readonly spentWei: bigint, readonly capWei: bigint, readonly wouldSpendWei: bigint) {
    super(
      `probe budget exhausted: ${fmt(spentWei)} already spent of a ${fmt(capWei)} cap, ` +
        `and this cycle needs ${fmt(wouldSpendWei)} more. Raise PROBE_BUDGET_ETH deliberately ` +
        `or stop probing — nothing here will quietly overspend it.`,
    )
    this.name = 'BudgetExceeded'
  }
}

export class GasTooExpensive extends Error {
  constructor(readonly gasPriceWei: bigint, readonly ceilingWei: bigint) {
    super(
      `gas is ${gwei(gasPriceWei)} gwei, above the ${gwei(ceilingWei)} gwei ceiling. ` +
        `Refusing to dispatch. A probe measured at any gas price is still a valid probe, ` +
        `so waiting costs nothing but a delay.`,
    )
    this.name = 'GasTooExpensive'
  }
}

const fmt = (w: bigint) => `${Number(w) / 1e18} ETH`
const gwei = (w: bigint) => (Number(w) / 1e9).toFixed(3)

/** Total actually spent: every funding transfer, minus everything swept back. */
export function spentToDate(stmts: Statements): bigint {
  const r = stmts.totalFundingSpend.get() as { funded: string | null; swept: string | null }
  return BigInt(r?.funded ?? 0) - BigInt(r?.swept ?? 0)
}

/**
 * Called BEFORE a cycle commits. Both brakes are checked here rather than at
 * dispatch, for the same reason the funding preflight is: a cycle that commits
 * and then cannot execute manufactures the committed-versus-published gap the
 * integrity check is supposed to read as dishonesty.
 */
export async function assertWithinBudget(
  publicClient: PublicClient,
  stmts: Statements,
  env: Env,
  wouldSpendWei: bigint,
): Promise<{ spentWei: bigint; remainingWei: bigint; gasPriceWei: bigint }> {
  // Parsed exactly from a decimal string, never via float arithmetic.
  // Math.round(0.009 * 1e18) is 8999999999999999 — a wei short. On a money path
  // that is the wrong kind of approximately.
  const capWei = parseEther(env.PROBE_BUDGET_ETH)
  const ceilingWei = parseGwei(env.MAX_GAS_PRICE_GWEI)

  const gasPriceWei = await publicClient.getGasPrice()
  if (gasPriceWei > ceilingWei) throw new GasTooExpensive(gasPriceWei, ceilingWei)

  const spentWei = spentToDate(stmts)
  if (spentWei + wouldSpendWei > capWei) throw new BudgetExceeded(spentWei, capWei, wouldSpendWei)

  return { spentWei, remainingWei: capWei - spentWei - wouldSpendWei, gasPriceWei }
}
