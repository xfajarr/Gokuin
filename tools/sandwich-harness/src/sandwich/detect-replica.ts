// A faithful, minimal TypeScript re-implementation of the EXACT heuristic in
// substreams/src/lib.rs's `map_sandwiches`, run directly against real Sepolia
// block data via the public RPC.
//
// Why this exists instead of just running the real Substreams module: the
// real pipeline needs a StreamingFast/Pinax/thegraph.market API key
// (SUBSTREAMS_API_KEY in repo-root .env.example) to stream Sepolia blocks,
// and none is configured in this environment, see README.md "Detector
// verification: what was actually run" for the full explanation and what
// running this for real against `substreams/substreams.sepolia.yaml` would
// look like with a key. This replica proves the HEURISTIC (same ordering
// rule, same opposite-direction check, same distinct-hash / same-from check)
// flags our three real, on-chain Sepolia transactions; it is not a
// substitute for running the actual .spkg, which is why both exist.
//
// Kept intentionally scoped to V3 Swap logs on ONE pool (this harness only
// ever touches WETH_USDC_POOL) rather than reproducing lib.rs's full
// block-wide, multi-pool generality, the parts that matter for "does the
// heuristic flag THIS sandwich" are reproduced exactly:
//   A before V before B, same block (implicit, one eth_getLogs call), same
//   pool (implicit, one address filter), opposite directions, distinct
//   hashes, A.from == B.from.
import { decodeAbiParameters, type Hex, type PublicClient } from 'viem'
import { V3_SWAP_TOPIC0 } from '../chain/addresses'

export type Direction = 'zero-for-one' | 'one-for-zero'

export interface SwapLeg {
  txIndex: number
  txHash: Hex
  from: Hex
  direction: Direction
}

export interface SandwichFinding {
  victimTxHash: Hex
  frontrunTxHash: Hex
  backrunTxHash: Hex
  attacker: Hex
  victim: Hex
  frontrunIndex: number
  victimIndex: number
  backrunIndex: number
}

function decodeV3Direction(data: Hex): Direction | null {
  const [amount0, amount1] = decodeAbiParameters([{ type: 'int256' }, { type: 'int256' }], data.slice(0, 2 + 128) as Hex)
  if (amount0 > 0n && amount1 < 0n) return 'zero-for-one'
  if (amount1 > 0n && amount0 < 0n) return 'one-for-zero'
  return null
}

/**
 * Fetches every V3 Swap log for `pool` in `blockNumber`, decodes each into a
 * SwapLeg (tx index, hash, sender, direction), and applies the exact
 * heuristic: for every victim position strictly between a same-from,
 * opposite-direction, distinct-hash attacker pair, report the tightest
 * enclosing pair, mirrors lib.rs step 2b.
 */
export async function detectSandwichesInBlock(
  publicClient: PublicClient,
  pool: Hex,
  blockNumber: bigint,
): Promise<SandwichFinding[]> {
  const logs = await publicClient.getLogs({
    address: pool,
    event: {
      type: 'event',
      name: 'Swap',
      inputs: [
        { name: 'sender', type: 'address', indexed: true },
        { name: 'recipient', type: 'address', indexed: true },
        { name: 'amount0', type: 'int256', indexed: false },
        { name: 'amount1', type: 'int256', indexed: false },
        { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
        { name: 'liquidity', type: 'uint128', indexed: false },
        { name: 'tick', type: 'int24', indexed: false },
      ],
    },
    fromBlock: blockNumber,
    toBlock: blockNumber,
  })

  // topic0 sanity check, belt and braces against ever decoding the wrong event.
  const raw = logs.filter(l => l.topics[0]?.toLowerCase() === V3_SWAP_TOPIC0)

  const legs: SwapLeg[] = []
  for (const log of raw) {
    const direction = decodeV3Direction(log.data)
    if (!direction) continue
    const tx = await publicClient.getTransaction({ hash: log.transactionHash! })
    legs.push({
      txIndex: log.transactionIndex ?? 0,
      txHash: log.transactionHash!,
      from: tx.from,
      direction,
    })
  }
  legs.sort((a, b) => a.txIndex - b.txIndex)

  const n = legs.length
  if (n < 3) return []

  const pairs: [number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k < n; k++) {
      const a = legs[i]
      const b = legs[k]
      if (a.from.toLowerCase() === b.from.toLowerCase() && a.direction !== b.direction && a.txHash !== b.txHash) {
        pairs.push([i, k])
      }
    }
  }
  if (pairs.length === 0) return []

  const findings: SandwichFinding[] = []
  for (let j = 0; j < n; j++) {
    let best: [number, number] | null = null
    for (const [i, k] of pairs) {
      if (i < j && j < k) {
        if (!best || k - i < best[1] - best[0]) best = [i, k]
      }
    }
    if (!best) continue
    const [i, k] = best
    findings.push({
      victimTxHash: legs[j].txHash,
      frontrunTxHash: legs[i].txHash,
      backrunTxHash: legs[k].txHash,
      attacker: legs[i].from,
      victim: legs[j].from,
      frontrunIndex: legs[i].txIndex,
      victimIndex: legs[j].txIndex,
      backrunIndex: legs[k].txIndex,
    })
  }
  return findings
}
