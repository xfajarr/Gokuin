// Predicts the front-run's actual USDC output via eth_call simulation
// (publicClient.simulateContract — no state change, no gas spent) so the
// back-run's amountIn can be sized correctly in USDC's own 6-decimal units.
//
// This exists because of a real bug this harness hit on its first live
// Sepolia attempt: the back-run's amountIn was built from the WETH-scaled
// (18-decimal) input amount instead of the USDC-scaled (6-decimal) amount
// the front-run would actually produce, asking the router to move ~1.8e15
// raw USDC units against an attacker balance of ~1.67e7 — an immediate
// revert. The back-run's Swap log never fired, so the on-chain data for
// that attempt was only a two-leg pattern, and detect-replica correctly
// found nothing (see README.md "A bug this harness hit for real").
import type { Hex, PublicClient } from 'viem'
import { SWAP_ROUTER_02_ABI } from '../chain/addresses'
import { ROUTER_ADDRESS } from './calldata'
import { WETH9, TEST_USDC, WETH_USDC_FEE } from '../chain/addresses'

/** Simulated (not broadcast) amountOut for a WETH->USDC exactInputSingle at current chain head. */
export async function quoteWethToUsdc(publicClient: PublicClient, from: Hex, amountInWei: bigint): Promise<bigint> {
  const { result } = await publicClient.simulateContract({
    address: ROUTER_ADDRESS,
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    account: from,
    args: [
      {
        tokenIn: WETH9,
        tokenOut: TEST_USDC,
        fee: WETH_USDC_FEE,
        recipient: from,
        amountIn: amountInWei,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  return result as bigint
}

/**
 * Safety margin taken off the simulated quote before using it as the
 * back-run's real amountIn — guards against small state drift between the
 * simulation (against current chain head) and actual inclusion (one block
 * later, potentially after the front-run itself has nudged the price).
 * 99% leaves ample room while still selling back almost everything acquired.
 */
export const BACKRUN_SAFETY_BPS = 9900n

export function applySafetyMargin(quotedOut: bigint): bigint {
  return (quotedOut * BACKRUN_SAFETY_BPS) / 10_000n
}
