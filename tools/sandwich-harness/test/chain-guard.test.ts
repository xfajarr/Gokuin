// Constraint 1's own test: the chain guard must reject anything that is not
// Sepolia (11155111) and accept only Sepolia. No env var, no flag, just
// what the RPC itself reports via eth_chainId.
import { describe, expect, it } from 'bun:test'
import { assertSepolia, SEPOLIA_CHAIN_ID, WrongChainError, type ChainIdSource } from '../src/guards/chain-guard'

function clientReporting(chainId: number): ChainIdSource {
  return { getChainId: async () => chainId }
}

describe('assertSepolia', () => {
  it('passes when the RPC reports Sepolia', async () => {
    await expect(assertSepolia(clientReporting(SEPOLIA_CHAIN_ID))).resolves.toBeUndefined()
  })

  it('rejects mainnet (chain id 1)', async () => {
    await expect(assertSepolia(clientReporting(1))).rejects.toThrow(WrongChainError)
  })

  it('rejects an arbitrary L2 (e.g. Base, chain id 8453)', async () => {
    await expect(assertSepolia(clientReporting(8453))).rejects.toThrow(WrongChainError)
  })

  it('rejects a local dev chain id (e.g. 31337 / Anvil default)', async () => {
    await expect(assertSepolia(clientReporting(31337))).rejects.toThrow(WrongChainError)
  })

  it('error message names both the required and the actual chain id', async () => {
    try {
      await assertSepolia(clientReporting(1))
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(WrongChainError)
      expect((err as WrongChainError).actualChainId).toBe(1)
      expect((err as Error).message).toContain('11155111')
      expect((err as Error).message).toContain('1')
    }
  })
})
