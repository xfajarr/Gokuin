// Hard ordering constraint (PRD §7.3): commitCycle must land on-chain BEFORE
// any probe is dispatched. Enforced in code via CommitBeforeDispatchGuard, not
// just by statement order — these tests attack it directly, including through
// the real dispatch.submitLeg code path.
import { describe, expect, test } from 'bun:test'
import type { PublicClient } from 'viem'
import { CommitBeforeDispatchGuard, CommitOrderViolation } from '../src/cycle/order-guard'
import { rotateEOA, submitLeg } from '../src/cycle/dispatch'
import type { RouteDef } from '../src/chain/routes'

describe('CommitBeforeDispatchGuard', () => {
  test('dispatch is refused before commit lands', () => {
    const guard = new CommitBeforeDispatchGuard()
    expect(guard.isCommitted).toBe(false)
    expect(() => guard.assertCanDispatch()).toThrow(CommitOrderViolation)
  })

  test('dispatch is allowed once commit has landed', () => {
    const guard = new CommitBeforeDispatchGuard()
    guard.markCommitted('0xcommit')
    expect(guard.isCommitted).toBe(true)
    expect(guard.assertCanDispatch()).toBe('0xcommit')
  })

  test('a dispatch attempted before an in-flight async commit resolves is still rejected', async () => {
    const guard = new CommitBeforeDispatchGuard()
    const commitLanded = new Promise<void>(resolve => {
      setTimeout(() => {
        guard.markCommitted('0xdelayed')
        resolve()
      }, 20)
    })

    // A caller that (incorrectly) fires dispatch without awaiting commit first
    // must still be blocked, regardless of how the orchestration is wired.
    expect(() => guard.assertCanDispatch()).toThrow(CommitOrderViolation)

    await commitLanded
    expect(() => guard.assertCanDispatch()).not.toThrow()
  })
})

describe('dispatch.submitLeg enforces the guard for real', () => {
  function fakePublicClient(): PublicClient {
    return {
      getBlockNumber: async () => 12345n,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }),
    } as unknown as PublicClient
  }

  function fakeRoute(): RouteDef {
    return {
      id: 'flashbots-protect',
      routeId: 1,
      rpcUrl: 'http://127.0.0.1:9999',
      transport: {} as any,
      capabilities: { private: true, bundled: true },
      dryRun: true,
    }
  }

  test('submitLeg throws CommitOrderViolation and never signs when commit has not landed', async () => {
    const guard = new CommitBeforeDispatchGuard()
    const account = rotateEOA()

    await expect(
      submitLeg(fakePublicClient(), fakeRoute(), account, '0x0000000000000000000000000000000000000001', '0x', 0n, guard),
    ).rejects.toThrow(CommitOrderViolation)
  })

  test('submitLeg proceeds (dry-run) once the guard has been committed', async () => {
    const guard = new CommitBeforeDispatchGuard()
    guard.markCommitted('0xcommit')
    const account = rotateEOA()

    const result = await submitLeg(
      fakePublicClient(),
      fakeRoute(),
      account,
      '0x0000000000000000000000000000000000000001',
      '0x',
      0n,
      guard,
    )

    expect(result.dryRun).toBe(true)
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(result.submittedBlock).toBe(12345)
  })
})
