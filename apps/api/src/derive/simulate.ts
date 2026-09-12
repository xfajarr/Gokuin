// eth_call the IDENTICAL calldata at includedBlock-1, compare to what the
// receipt actually paid out (PRD §11 extractedWei = simOut - realOut).
import { decodeFunctionResult, keccak256, toBytes, type Hex, type PublicClient } from 'viem'
import { SWAP_ROUTER_ABI } from '../cycle/dispatch'

const TRANSFER_TOPIC = keccak256(toBytes('Transfer(address,address,uint256)'))

/** simOut: eth_call the same calldata against state at includedBlock-1. */
export async function simulateAtBlock(
  publicClient: PublicClient,
  tx: { from: Hex; to: Hex; data: Hex; value?: bigint },
  includedBlock: number,
): Promise<bigint> {
  const result = await publicClient.call({
    account: tx.from,
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    blockNumber: BigInt(includedBlock - 1),
  })
  if (!result.data) return 0n
  const amounts = decodeFunctionResult({
    abi: SWAP_ROUTER_ABI,
    functionName: 'swapExactETHForTokens',
    data: result.data,
  }) as readonly bigint[]
  return amounts[amounts.length - 1] ?? 0n
}

/** realOut: what the receipt's Transfer logs actually paid to `recipient`. */
export async function getRealOutFromReceipt(
  publicClient: PublicClient,
  txHash: Hex,
  recipient: Hex,
): Promise<bigint> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
  return sumTransfersToRecipient(receipt.logs as { topics: readonly Hex[]; data: Hex }[], recipient)
}

/** Pure — testable without a live client. Exported for the metrics round-trip test. */
export function sumTransfersToRecipient(
  logs: readonly { topics: readonly Hex[]; data: Hex }[],
  recipient: Hex,
): bigint {
  let total = 0n
  for (const log of logs) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue
    const toTopic = log.topics[2]
    if (!toTopic) continue
    const to = (`0x${toTopic.slice(-40)}`).toLowerCase()
    if (to !== recipient.toLowerCase()) continue
    total += BigInt(log.data)
  }
  return total
}
