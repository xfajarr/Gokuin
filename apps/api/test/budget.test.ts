// The operator's budget is $10. That has to be a property of the code, not of
// their attention — mainnet gas has moved 500x before, and nobody watches a
// scheduled cycle at 3am.
//
// Two brakes, tested separately because they fail differently: a cumulative
// spend cap, and a gas-price ceiling. Neither alone is sufficient. The cap would
// let one 400 gwei cycle eat everything; the ceiling would let a thousand cheap
// cycles add up past the limit.
import { describe, expect, it } from 'bun:test'
import { parseEther, parseGwei } from 'viem'
import { assertWithinBudget, BudgetExceeded, GasTooExpensive, spentToDate } from '../src/chain/budget'
import type { Env } from '../src/env'
import type { Statements } from '../src/db'

const env = { PROBE_BUDGET_ETH: '0.004', MAX_GAS_PRICE_GWEI: '2' } as Env
const eth = (n: string) => parseEther(n)
const gwei = (n: string) => parseGwei(n)

function stmts(fundedEth: string, sweptEth: string): Statements {
  return {
    totalFundingSpend: { get: () => ({ funded: eth(fundedEth).toString(), swept: eth(sweptEth).toString() }) },
  } as unknown as Statements
}
const client = (gasGwei: string) => ({ getGasPrice: async () => gwei(gasGwei) }) as any

describe('spend cap', () => {
  it('counts what was spent net of sweeps, not gross funding', async () => {
    // capital that came back is not spend. Counting gross would exhaust a budget
    // that was never actually consumed.
    expect(spentToDate(stmts('0.01', '0.009'))).toBe(eth('0.001'))
  })

  it('allows a cycle that fits', async () => {
    const r = await assertWithinBudget(client('0.05'), stmts('0.001', '0'), env, eth('0.001'))
    expect(r.remainingWei).toBe(eth('0.002'))
  })

  it('refuses the cycle that would cross the cap, before it commits', async () => {
    await expect(assertWithinBudget(client('0.05'), stmts('0.0035', '0'), env, eth('0.001'))).rejects.toBeInstanceOf(
      BudgetExceeded,
    )
  })

  it('survives a restart, because it reads the ledger rather than a counter', async () => {
    // nothing in memory carries over; spentToDate is derived from funding rows
    expect(spentToDate(stmts('0.004', '0'))).toBe(eth('0.004'))
    await expect(assertWithinBudget(client('0.05'), stmts('0.004', '0'), env, 1n)).rejects.toBeInstanceOf(BudgetExceeded)
  })
})

describe('gas ceiling', () => {
  it('refuses to dispatch above the ceiling even with budget to spare', async () => {
    await expect(assertWithinBudget(client('50'), stmts('0', '0'), env, 1n)).rejects.toBeInstanceOf(GasTooExpensive)
  })

  it('is checked before the spend cap — a spike is the more urgent stop', async () => {
    // both would fail here; the gas error is the one that tells you to wait
    // rather than to give up
    await expect(assertWithinBudget(client('50'), stmts('0.004', '0'), env, eth('1'))).rejects.toBeInstanceOf(GasTooExpensive)
  })

  it('names the actual gas price so the operator can decide whether to wait', async () => {
    try {
      await assertWithinBudget(client('37.5'), stmts('0', '0'), env, 1n)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('37.500 gwei')
      expect((e as Error).message).toContain('2.000 gwei')
    }
  })
})
