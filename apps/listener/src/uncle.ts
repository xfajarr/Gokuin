// Uncle re-broadcast detection: a transaction that was already included in a
// block, but that block later stopped being canonical (reorged/uncled),
// reappearing in the public mempool. These are stored but excluded from the
// leak flag (PRD §7.4, §11 "Uncle re-broadcasts excluded and logged separately").
import type { Hex, PublicClient } from 'viem'

export function createUncleTracker() {
  const includedAt = new Map<string, { blockNumber: bigint; blockHash: Hex }>()

  return {
    /** Feed every new block's transactions in as they're seen (live watchBlocks). */
    recordBlock(block: { number: bigint; hash: Hex; transactions: readonly (Hex | { hash: Hex })[] }) {
      for (const tx of block.transactions) {
        const hash = (typeof tx === 'string' ? tx : tx.hash).toLowerCase()
        includedAt.set(hash, { blockNumber: block.number, blockHash: block.hash })
      }
    },

    /** True if this hash was previously included in a block that is no longer canonical. */
    async isUncleRebroadcast(publicClient: PublicClient, txHash: string): Promise<boolean> {
      const prior = includedAt.get(txHash.toLowerCase())
      if (!prior) return false
      try {
        const canonical = await publicClient.getBlock({ blockNumber: prior.blockNumber })
        return canonical.hash !== prior.blockHash
      } catch {
        return false
      }
    },
  }
}

export type UncleTracker = ReturnType<typeof createUncleTracker>
