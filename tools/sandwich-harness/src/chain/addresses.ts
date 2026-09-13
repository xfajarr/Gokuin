export const SEPOLIA_CHAIN_ID = 11155111

/** Uniswap V3 factory on Sepolia. Verified: router.factory() returns this exact address. */
export const UNISWAP_V3_FACTORY: `0x${string}` = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c'

/**
 * SwapRouter02 on Sepolia (IV3SwapRouter, no `deadline` field in
 * ExactInputSingleParams, unlike the older SwapRouter). Verified:
 * `router.WETH9()` returns WETH9 below, `router.factory()` returns the
 * factory above.
 */
export const SWAP_ROUTER_02: `0x${string}` = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E'

/** Canonical WETH9 on Sepolia. Verified via router.WETH9(). */
export const WETH9: `0x${string}` = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'

/**
 * Uniswap Labs' test USDC on Sepolia (18-decimals-free test token; check its
 * own `decimals()` before assuming 6, as some deployments differ from
 * mainnet USDC). This is `token0` of the pool below.
 */
export const TEST_USDC: `0x${string}` = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

/**
 * The WETH/USDC 0.05% pool. Verified three ways: (1) `factory.getPool(USDC,
 * WETH, 500)` returns this address, (2) the pool's own `token0()`/`token1()`
 * match TEST_USDC/WETH9, (3) `liquidity()` returns a large non-zero value
 * (real, not an empty/rugged pool).
 */
export const WETH_USDC_POOL: `0x${string}` = '0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1'
export const WETH_USDC_FEE = 500

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

export const WETH9_ABI = [
  ...ERC20_ABI,
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
] as const

/** IV3SwapRouter (SwapRouter02): exactInputSingle has no `deadline` field. */
export const SWAP_ROUTER_02_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

export const UNISWAP_V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

export const UNISWAP_V3_POOL_ABI = [
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'fee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint24' }],
  },
  {
    type: 'function',
    name: 'liquidity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
  },
  {
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
] as const

/** keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"): must match substreams/src/lib.rs V3_SWAP_TOPIC0. */
export const V3_SWAP_TOPIC0 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' as const
