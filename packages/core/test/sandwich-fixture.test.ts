// PRD.md §15: "the fork test and the TypeScript metric test consume the same
// fixture and must agree. If the contract and the API disagree about what a
// sandwich cost, the project has no product."
//
// This test is the TypeScript half of that agreement. The Solidity half is
// contracts/test/ForkDerive.t.sol::testFork_DeriveKnownSandwich, which forks
// mainnet at the same block, replays the same victim transaction, and must
// assert the exact same extractedWei value asserted here. Both read the
// numbers from packages/core/src/fixtures.ts (Solidity hardcodes a copy,
// since it can't import TS, see the comment at the top of that file).
import { describe, expect, it } from 'bun:test'
import { computeExtracted } from '../src/metrics'
import { KNOWN_CLEAN_BLOCK, KNOWN_SANDWICH, KNOWN_SANDWICH_DERIVED } from '../src/fixtures'

describe('known-sandwich fixture (block 22450093, Uniswap V2 WETH/RATO)', () => {
  it('computeExtracted(simOut, realOut) equals the pinned extractedWei, same value ForkDerive.t.sol must produce', () => {
    const extracted = computeExtracted(KNOWN_SANDWICH_DERIVED.simOut, KNOWN_SANDWICH_DERIVED.realOut)
    expect(extracted).toBe(KNOWN_SANDWICH_DERIVED.extractedWei)
    expect(extracted).toBe(12913434669342331n)
  })

  it('realOut is exactly the victim leg\'s decoded Swap-log amount out', () => {
    expect(KNOWN_SANDWICH_DERIVED.realOut).toBe(KNOWN_SANDWICH.victim.amountOutRaw)
  })

  it('extractedWei is positive, the front-run made the victim strictly worse off', () => {
    expect(KNOWN_SANDWICH_DERIVED.extractedWei > 0n).toBe(true)
    expect(KNOWN_SANDWICH_DERIVED.simOut > KNOWN_SANDWICH_DERIVED.realOut).toBe(true)
  })

  describe('structural preconditions the sandwich heuristic requires', () => {
    it('orders the three legs i < j < k', () => {
      expect(KNOWN_SANDWICH.frontrun.txIndex).toBeLessThan(KNOWN_SANDWICH.victim.txIndex)
      expect(KNOWN_SANDWICH.victim.txIndex).toBeLessThan(KNOWN_SANDWICH.backrun.txIndex)
    })

    it('places all three legs on the same pool', () => {
      expect(KNOWN_SANDWICH.frontrun.pool).toBe(KNOWN_SANDWICH.pool)
      expect(KNOWN_SANDWICH.victim.pool).toBe(KNOWN_SANDWICH.pool)
      expect(KNOWN_SANDWICH.backrun.pool).toBe(KNOWN_SANDWICH.pool)
    })

    it('uses three distinct transaction hashes', () => {
      const hashes = new Set([
        KNOWN_SANDWICH.frontrun.txHash,
        KNOWN_SANDWICH.victim.txHash,
        KNOWN_SANDWICH.backrun.txHash,
      ])
      expect(hashes.size).toBe(3)
    })

    it('has the same attacker address on the front-run and back-run, distinct from the victim', () => {
      expect(KNOWN_SANDWICH.frontrun.from).toBe(KNOWN_SANDWICH.attacker)
      expect(KNOWN_SANDWICH.backrun.from).toBe(KNOWN_SANDWICH.attacker)
      expect(KNOWN_SANDWICH.victim.from).toBe(KNOWN_SANDWICH.victimFrom)
      expect(KNOWN_SANDWICH.victim.from).not.toBe(KNOWN_SANDWICH.attacker)
    })

    it("has the back-run's RATO input exactly equal to the front-run's RATO output (round-trip)", () => {
      expect(KNOWN_SANDWICH.backrun.amountInRaw).toBe(KNOWN_SANDWICH.frontrun.amountOutRaw)
    })
  })
})

describe('known-clean-block fixture (block 22450094, negative control)', () => {
  it('is the block immediately after the sandwich block, on the same pool', () => {
    expect(KNOWN_CLEAN_BLOCK.block).toBe(KNOWN_SANDWICH.block + 1)
    expect(KNOWN_CLEAN_BLOCK.pool).toBe(KNOWN_SANDWICH.pool)
  })
})
