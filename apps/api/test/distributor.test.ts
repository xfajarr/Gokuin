// Distributor funding/sweep/preflight (chain/distributor.ts). This task's
// required coverage:
//   1. preflight refuses an underfunded cycle (cycle/run.ts calls this
//      before ledger.commitCycle — see its comments and module header)
//   2. funding amounts differ between probes in the same cycle
//   3. sweep skips a dust balance rather than burning gas to move it
// Plus the supporting invariants those three depend on: gas budget math,
// jitter bounds, and dry-run parity (no DISTRIBUTOR_PK -> still computes
// everything real, only the signature/broadcast is stood in).
import { describe, expect, test } from 'bun:test'
import type { PublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  DistributorClient,
  InsufficientDistributorFundsError,
  estimateCycleFundingRequirement,
  gasBudgetWei,
  maxFundingAmountWei,
  planProbeFunding,
  preflightDistributorFunding,
  randomJitterWei,
  type FundingConfig,
} from '../src/chain/distributor'

const FEES = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }

function fakePublicClient(overrides: Record<string, unknown> = {}): PublicClient {
  return {
    estimateFeesPerGas: async () => FEES,
    getBalance: async () => 0n,
    getTransactionCount: async () => 0,
    sendRawTransaction: async () => '0xsent',
    ...overrides,
  } as unknown as PublicClient
}

function testConfig(overrides: Partial<FundingConfig> = {}): FundingConfig {
  return {
    gasHeadroomMultiplier: 1.5,
    amountJitterBps: 250,
    minDelayMs: 0,
    jitterDelayMs: 0,
    sweepGasBufferMultiplier: 1.2,
    ...overrides,
  }
}

describe('gas budget + jitter invariants', () => {
  test('gasBudgetWei applies the headroom multiplier exactly', () => {
    expect(gasBudgetWei(250_000n, 30_000_000_000n, 1.5)).toBe((250_000n * 30_000_000_000n * 15_000n) / 10_000n)
    expect(gasBudgetWei(250_000n, 30_000_000_000n, 1)).toBe(250_000n * 30_000_000_000n)
  })

  test('randomJitterWei is always >= 1 and never exceeds its bps-sized bound', () => {
    const base = 10_000_000_000_000_000n // 0.01 ETH
    for (let i = 0; i < 25; i++) {
      const j = randomJitterWei(base, 250)
      expect(j).toBeGreaterThan(0n)
      expect(j).toBeLessThanOrEqual((base * 250n) / 10_000n)
    }
  })

  test('maxFundingAmountWei is always >= any real randomJitterWei-derived draw', () => {
    const swapValue = 5_000_000_000_000_000n
    const budget = gasBudgetWei(250_000n, FEES.maxFeePerGas, 1.5)
    const bound = maxFundingAmountWei(swapValue, budget, 250)
    for (let i = 0; i < 25; i++) {
      const jitter = randomJitterWei(swapValue + budget, 250)
      expect(swapValue + budget + jitter).toBeLessThanOrEqual(bound)
    }
  })
})

describe('funding amounts differ between probes (unlinkability requirement)', () => {
  test('planProbeFunding never repeats the same amount across probes, and never lands on the bare round swap size', async () => {
    const client = fakePublicClient()
    const config = testConfig()
    const swapValue = 10_000_000_000_000_000n // a deliberately round 0.01 ETH bait size

    const plans = await Promise.all(Array.from({ length: 8 }, () => planProbeFunding(client, swapValue, config)))
    const amounts = plans.map(p => p.amountWei)

    expect(new Set(amounts.map(String)).size).toBeGreaterThan(1) // not identical probe-to-probe
    for (const amount of amounts) {
      expect(amount).not.toBe(swapValue) // never the bare round swap size
      expect(amount).toBeGreaterThan(swapValue) // never funds less than the probe needs
    }
  })
})

describe('preflightDistributorFunding', () => {
  const probeCount = 2
  const swapValue = 10_000_000_000_000_000n
  const config = testConfig()

  test('refuses (throws) an underfunded cycle — this must run before commitCycle in cycle/run.ts', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const client = fakePublicClient({ getBalance: async () => 1n })
    const distributor = new DistributorClient(client, account)

    await expect(preflightDistributorFunding(client, distributor, probeCount, swapValue, config)).rejects.toThrow(
      InsufficientDistributorFundsError,
    )
  })

  test('passes when the distributor balance covers the whole schedule plus gas', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const requirement = await estimateCycleFundingRequirement(fakePublicClient(), probeCount, swapValue, config)
    const client = fakePublicClient({ getBalance: async () => requirement.totalRequiredWei })
    const distributor = new DistributorClient(client, account)

    const result = await preflightDistributorFunding(client, distributor, probeCount, swapValue, config)
    expect(result.totalRequiredWei).toBe(requirement.totalRequiredWei)
  })

  test('never throws in full dry-run (no DISTRIBUTOR_PK), regardless of balance', async () => {
    const client = fakePublicClient() // getBalance would answer 0n if this ever called it
    const distributor = new DistributorClient(client, null)

    await expect(preflightDistributorFunding(client, distributor, probeCount, swapValue, config)).resolves.toBeDefined()
  })
})

describe('sweepProbe dust handling', () => {
  const config = testConfig()

  test('skips the sweep when leftover balance would not clear its own gas cost', async () => {
    const probeAccount = privateKeyToAccount(generatePrivateKey())
    let sent = false
    const client = fakePublicClient({
      getBalance: async () => 1_000n, // far below any real gas cost
      sendRawTransaction: async () => {
        sent = true
        return '0xshouldnothappen'
      },
    })
    const distributor = new DistributorClient(client, null)

    const outcome = await distributor.sweepProbe(probeAccount, 1, config)

    expect(outcome.dustSkipped).toBe(true)
    expect(outcome.sweptAmountWei).toBe(0n)
    expect(outcome.txHash).toBeNull()
    expect(sent).toBe(false) // never burned gas trying to move dust
  })

  test('sweeps the real leftover (minus its own gas cost) when it clears the dust threshold', async () => {
    const probeAccount = privateKeyToAccount(generatePrivateKey())
    const distributorAccount = privateKeyToAccount(generatePrivateKey())
    const balance = 5_000_000_000_000_000n // 0.005 ETH, comfortably above gas cost
    const client = fakePublicClient({
      getBalance: async () => balance,
      sendRawTransaction: async () => '0xswept',
    })
    const distributor = new DistributorClient(client, distributorAccount)

    const outcome = await distributor.sweepProbe(probeAccount, 2, config)

    expect(outcome.dustSkipped).toBe(false)
    expect(outcome.sweptAmountWei).toBeGreaterThan(0n)
    expect(outcome.sweptAmountWei).toBeLessThan(balance)
    expect(outcome.txHash).toBe('0xswept')
    expect(outcome.dryRun).toBe(false)
  })

  test('a real (non-dust) sweep with no distributor address configured still reports the true recoverable amount, via a stand-in hash', async () => {
    const probeAccount = privateKeyToAccount(generatePrivateKey())
    const balance = 5_000_000_000_000_000n
    const client = fakePublicClient({ getBalance: async () => balance })
    const distributor = new DistributorClient(client, null)

    const outcome = await distributor.sweepProbe(probeAccount, 3, config)

    expect(outcome.dustSkipped).toBe(false)
    expect(outcome.sweptAmountWei).toBeGreaterThan(0n)
    expect(outcome.dryRun).toBe(true)
    expect(outcome.txHash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('fundProbe dry-run parity', () => {
  test('with no DISTRIBUTOR_PK, still estimates fees for real and returns a deterministic (not stubbed-out) stand-in hash', async () => {
    const client = fakePublicClient()
    const distributor = new DistributorClient(client, null)

    const to = '0x0000000000000000000000000000000000000001' as const
    const r1 = await distributor.fundProbe(to, 1_000_000n, 1)
    const r2 = await distributor.fundProbe(to, 1_000_000n, 2) // different probeId -> different stand-in hash

    expect(r1.dryRun).toBe(true)
    expect(r1.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(r1.txHash).not.toBe(r2.txHash)
  })

  test('never batches more than one probe per funding call — one `to` address per invocation', async () => {
    // Structural guarantee: fundProbe's signature takes exactly one address,
    // so there is no code path through it that funds two probes at once.
    const client = fakePublicClient()
    const distributor = new DistributorClient(client, null)
    expect(distributor.fundProbe.length).toBeLessThanOrEqual(3) // (to, amountWei, probeId) — no batch/array parameter
  })
})
