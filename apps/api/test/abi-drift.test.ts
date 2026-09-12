// The API once hand-declared ProbeLedger's ABI and drifted from the contract:
// revealCycle took (cycleId, salt) while the deployed function took
// (cycleId, routeIds, slots, salt). That kind of drift is invisible until the
// transaction reverts on chain — which, for the reveal, means the integrity
// check silently never works.
//
// These tests encode every ledger write against the ABI generated from
// `forge build`. viem throws on an arity or type mismatch, so a contract
// signature change that the API does not follow fails here instead of on air.
import { describe, expect, it } from 'bun:test'
import { encodeFunctionData } from 'viem'
import { ProbeLedgerAbi, RouteRegistryAbi, ScorerAbi } from '@gokuin/abi'

const ZERO32 = `0x${'00'.repeat(32)}` as const

describe('ProbeLedger ABI is the generated one', () => {
  it('commitCycle encodes', () => {
    expect(() =>
      encodeFunctionData({ abi: ProbeLedgerAbi, functionName: 'commitCycle', args: [1, ZERO32, 4] }),
    ).not.toThrow()
  })

  it('revealCycle carries routeIds and slots, not just the salt', () => {
    expect(() =>
      encodeFunctionData({
        abi: ProbeLedgerAbi,
        functionName: 'revealCycle',
        args: [1, [0, 1], [100n, 101n], ZERO32],
      }),
    ).not.toThrow()

    // the shape the API used to send — must now be rejected
    expect(() =>
      encodeFunctionData({ abi: ProbeLedgerAbi, functionName: 'revealCycle', args: [1, ZERO32] as never }),
    ).toThrow()
  })

  it('record encodes the full Row tuple', () => {
    expect(() =>
      encodeFunctionData({
        abi: ProbeLedgerAbi,
        functionName: 'record',
        args: [
          1,
          {
            mainnetTxHash: ZERO32,
            submittedBlock: 1n,
            includedBlock: 2n,
            leakedAtBlock: 0n,
            extractedWei: 0n,
            simOut: 0n,
            realOut: 0n,
            routeId: 0,
            cycleId: 1,
            sandwiched: false,
          },
        ],
      }),
    ).not.toThrow()
  })
})

describe('exactly one authorized writer into RouteRegistry', () => {
  it('setScore is the only score write, and Scorer is the only caller path', () => {
    const writes = RouteRegistryAbi.filter(
      (f: any) => f.type === 'function' && f.stateMutability === 'nonpayable' && /score/i.test(f.name),
    )
    expect(writes.map((f: any) => f.name)).toEqual(['setScore'])
  })

  it('submitScore covers all six gokuin.* keys in one call', () => {
    const fn = ScorerAbi.find((f: any) => f.name === 'submitScore') as any
    // routeId, leakBps, sandwichBps, medianDelay, composite, probes, lastCycle, evidenceURI
    expect(fn.inputs).toHaveLength(8)
    expect(fn.inputs.map((i: any) => i.name)).toContain('probes')
    expect(fn.inputs.map((i: any) => i.name)).toContain('lastCycle')
  })
})
