// Watches the public mempool for the victim probe transaction, the same
// approach apps/listener/src/index.ts uses (viem watchPendingTransactions
// over a websocket transport): reused here rather than re-invented, since
// this is exactly the "is this transaction visible in the public mempool"
// question the listener already answers for the real system.
//
// Once the victim's hash is seen, `onVictimSeen` fires immediately so the
// caller can broadcast the front-run and back-run with as little delay as
// possible, every millisecond spent here is a millisecond less margin for
// the fee ladder in fee-ladder.ts to actually land the three legs in order.
import type { PublicClient } from 'viem'

export interface WatchForVictimOptions {
  publicClient: PublicClient
  victimAddress: `0x${string}`
  onVictimSeen: (txHash: `0x${string}`) => void
  /** Cap on getTransaction lookups so a busy testnet mempool cannot spiral into unbounded RPC calls. */
  maxLookupsPerBatch?: number
}

export function watchForVictim(opts: WatchForVictimOptions): () => void {
  const { publicClient, victimAddress, onVictimSeen, maxLookupsPerBatch = 50 } = opts
  const target = victimAddress.toLowerCase()
  let found = false

  const unwatch = publicClient.watchPendingTransactions({
    onTransactions: async hashes => {
      if (found) return
      const batch = hashes.slice(0, maxLookupsPerBatch)
      for (const hash of batch) {
        if (found) return
        try {
          const tx = await publicClient.getTransaction({ hash })
          if (tx?.from?.toLowerCase() === target) {
            found = true
            onVictimSeen(hash)
            return
          }
        } catch {
          // Transaction dropped from the pool between the hash notification
          // and the lookup, routine on a public testnet mempool, not an error.
        }
      }
    },
  })

  return unwatch
}
