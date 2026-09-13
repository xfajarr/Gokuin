// Calldata builders for the three legs. Kept separate from execution/signing
// so the fee-laddering and dry-run logic in run.ts can stay focused on
// sequencing, not ABI encoding.
import { encodeFunctionData, type Hex } from 'viem'
import {
  WETH9_ABI,
  ERC20_ABI,
  SWAP_ROUTER_02_ABI,
  SWAP_ROUTER_02,
  WETH9,
  TEST_USDC,
  WETH_USDC_FEE,
} from '../chain/addresses'

const MAX_UINT256 = (1n << 256n) - 1n

export function encodeWrapEth(): Hex {
  return encodeFunctionData({ abi: WETH9_ABI, functionName: 'deposit', args: [] })
}

export function encodeApprove(spender: Hex, amount: bigint = MAX_UINT256): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] })
}

export type SwapDirection = 'weth-to-usdc' | 'usdc-to-weth'

/**
 * exactInputSingle calldata for the WETH/USDC 0.05% pool. `amountOutMinimum`
 * is deliberately 0 for this demo: the goal is a correctly-ordered,
 * detector-matching sandwich, not a profitable one, and a real
 * amountOutMinimum would risk a revert (and a broken block-ordering take)
 * over testnet-only "profit" that has no monetary meaning anyway. Documented
 * plainly rather than silently, see README.md "why amountOutMinimum is 0".
 */
export function encodeSwap(direction: SwapDirection, recipient: Hex, amountIn: bigint): Hex {
  const [tokenIn, tokenOut] = direction === 'weth-to-usdc' ? [WETH9, TEST_USDC] : [TEST_USDC, WETH9]
  return encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee: WETH_USDC_FEE,
        recipient,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
}

export const ROUTER_ADDRESS = SWAP_ROUTER_02
