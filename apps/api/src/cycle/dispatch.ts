// Twin dispatch (PRD §7.3 step 3 / §14 P2): rotate a fresh, never-before-seen
// EOA per probe, build ONE swap's calldata, and submit the IDENTICAL calldata
// through two different routes so the only variable between the pair is the
// route (and the sending key, which must differ per probe so routes can't be
// fingerprinted by a shared sender, see PRD §18 "Probes fingerprinted").
//
// Funding the freshly-rotated EOAs (PRD §18 "funded through a distributor")
// is handled by chain/distributor.ts and wired in cycle/run.ts: each probe is
// funded from the distributor account, one probe per funding transaction,
// before its swap is submitted. `submitLeg` still signs a real,
// correctly-encoded transaction and always computes its real would-be hash;
// it only skips the network call when the route is in dryRun (fixture RPC)
// mode, which is the norm for this hackathon environment.
import { encodeFunctionData, keccak256, parseGwei, type Hex, type PublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import type { RouteId } from '@gokuin/core'
import type { RouteDef } from '../chain/routes'
import { CommitBeforeDispatchGuard } from './order-guard'

/** Mainnet WETH, path[0] for the bait swap. Not a secret, just a well-known address. */
export const WETH_MAINNET: Hex = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

// Minimal UniswapV2-router-shaped ABI. `pool` in probe rows is used as the
// bait pool's output-token address for calldata-building purposes only, the
// metrics under test (leak / sandwich / delay / extracted value) depend on
// the tx being real and the calldata being identical between legs, not on
// which DEX flavour is targeted.
export const SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapExactETHForTokens',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const

/** Gas limit budgeted for a probe's own swap tx. Shared with chain/distributor.ts
 *  so the distributor funds each probe with exactly what this dispatch step
 *  will actually spend on gas, a single source of truth instead of two
 *  copies of "250_000" that could silently drift apart. */
export const SWAP_GAS_LIMIT = 250_000n

export interface SwapParams {
  router: Hex
  pool: Hex // bait pool's output token
  recipient: Hex // fixed across both legs, required for calldata identity
  amountInWei: bigint
  slippageBps: number
  deadline: bigint
}

/** amountOutMin computed off the bait's own slippage tolerance, thin pool, deliberately aggressive (PRD §14 P2). */
export function minOutForSlippage(quotedOut: bigint, slippageBps: number): bigint {
  const keepBps = 10_000n - BigInt(slippageBps)
  return (quotedOut * keepBps) / 10_000n
}

export function buildSwapCalldata(p: SwapParams, amountOutMin: bigint): Hex {
  return encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: 'swapExactETHForTokens',
    args: [amountOutMin, [WETH_MAINNET, p.pool], p.recipient, p.deadline],
  })
}

export function rotateEOA(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey())
}

export interface TwinLeg {
  route: RouteId
  account: PrivateKeyAccount
}

export interface Twin {
  twinGroup: string
  calldata: Hex
  legs: [TwinLeg, TwinLeg]
}

/** Builds one swap and a fresh sending EOA per route, the calldata is byte-identical across legs. */
export function buildTwin(routes: [RouteId, RouteId], params: SwapParams, amountOutMin: bigint): Twin {
  const calldata = buildSwapCalldata(params, amountOutMin)
  const legs = routes.map(route => ({ route, account: rotateEOA() })) as [TwinLeg, TwinLeg]
  return { twinGroup: crypto.randomUUID(), calldata, legs }
}

export interface SubmitResult {
  txHash: Hex
  submittedBlock: number
  dryRun: boolean
}

/**
 * Signs and (unless the route is dry-run) submits one leg's transaction.
 * `guard` enforces PRD §7.3's hard ordering constraint: this throws
 * immediately if commitCycle has not landed yet, regardless of caller order.
 */
export async function submitLeg(
  publicClient: PublicClient,
  route: RouteDef,
  account: PrivateKeyAccount,
  to: Hex,
  data: Hex,
  value: bigint,
  guard: CommitBeforeDispatchGuard,
): Promise<SubmitResult> {
  guard.assertCanDispatch()

  const submittedBlock = Number(await publicClient.getBlockNumber())
  const fees = await publicClient.estimateFeesPerGas().catch(() => null)
  const signed = await account.signTransaction({
    to,
    data,
    value,
    nonce: 0, // freshly-rotated EOA, always nonce 0
    chainId: mainnet.id,
    gas: SWAP_GAS_LIMIT,
    maxFeePerGas: fees?.maxFeePerGas ?? parseGwei('30'),
    maxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? parseGwei('2'),
    type: 'eip1559',
  })

  if (route.dryRun) {
    const txHash = keccak256(signed)
    console.warn(`[dispatch:dry-run] route=${route.id} not broadcasting (fixture RPC). would-be hash ${txHash}`)
    return { txHash, submittedBlock, dryRun: true }
  }

  const txHash = await publicClient.sendRawTransaction({ serializedTransaction: signed })
  return { txHash, submittedBlock, dryRun: false }
}
