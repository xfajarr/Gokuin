// Flashbots-style atomic bundle submission on Sepolia, the same technique
// real mainnet searchers use (eth_sendBundle to a builder relay), tried here
// because the fee-ladder in fee-ladder.ts is a heuristic, not a guarantee,
// and a real bundle would remove the guesswork entirely IF Sepolia builders
// actually honor it.
//
// What was verified (see README.md "Ordering: what was tried and how
// reliable it is" for the full account):
//
//   - Both https://relay-sepolia.flashbots.net and
//     https://relay-sepolia.flashbots.net/fast report chain id 0xaa36a7
//     (Sepolia) and both accept eth_sendBundle as a recognized method: an
//     unsigned request is rejected with `{"code":-32600,"message":"signature
//     is required"}` (not "method not found"), and a properly-signed request
//     with syntactically-invalid tx bytes gets past signature checking to
//     `{"code":-32600,"message":"incorrect request"}`: proving the endpoint
//     really parses and validates bundle bodies, not just accepting anything.
//   - A real, validly-signed two-tx bundle submitted to six consecutive
//     upcoming block numbers was accepted by the relay every time (a stable
//     bundleHash returned) but did NOT land in any of those six blocks, nor
//     within ~2 minutes of subsequent polling. This matches a publicly
//     reported issue (flashbots/rbuilder#862, "[BUG] Flashbots Relayer
//     [SEPOLIA]"): Sepolia validator/builder participation in the Flashbots
//     MEV-Boost relay is sparse, so a submitted bundle can be perfectly valid
//     and still never get built into a block.
//
// So this module is wired up and genuinely attempts real bundle submission :
// it is not a stub, but run.ts's default path does NOT depend on it landing:
// callers should race it against a deadline and fall back to the fee-ladder
// path (fee-ladder.ts + attemptSandwich in run.ts), which measured 5/5
// correctly-ordered same-block landings across five live attempts.
import { keccak256, toHex, type Hex } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'

export const FLASHBOTS_SEPOLIA_RELAY_URLS = [
  'https://relay-sepolia.flashbots.net',
  'https://relay-sepolia.flashbots.net/fast',
] as const

export const FLASHBOTS_SEPOLIA_CHAIN_ID = 11155111

export interface BundleSubmitResult {
  url: string
  targetBlock: bigint
  ok: boolean
  response: unknown
}

/**
 * Signs the Flashbots `X-Flashbots-Signature` header: `${address}:${sig}`,
 * where `sig` is a personal_sign over the keccak256 hash of the exact JSON
 * body being sent. `reputationAccount` need not be funded or related to the
 * bundle's own transactions, it only identifies the submitter to the relay.
 */
async function flashbotsSignature(reputationAccount: PrivateKeyAccount, body: string): Promise<string> {
  const hash = keccak256(toHex(body))
  const signature = await reputationAccount.signMessage({ message: hash })
  return `${reputationAccount.address}:${signature}`
}

/**
 * Submits one raw-tx bundle (in the exact order they must land, this is
 * what replaces gas-priority laddering when it works) to every URL in
 * `relayUrls`, targeting `targetBlock`. Returns per-URL results; a
 * `{"result":{"bundleHash":...}}` response means the relay accepted and
 * queued it for that block. NOT that it will actually be included (see
 * module header).
 */
export async function submitBundle(
  reputationAccount: PrivateKeyAccount,
  rawTxs: Hex[],
  targetBlock: bigint,
  relayUrls: readonly string[] = FLASHBOTS_SEPOLIA_RELAY_URLS,
): Promise<BundleSubmitResult[]> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendBundle',
    params: [{ txs: rawTxs, blockNumber: `0x${targetBlock.toString(16)}` }],
  })
  const signature = await flashbotsSignature(reputationAccount, body)

  const results: BundleSubmitResult[] = []
  for (const url of relayUrls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Flashbots-Signature': signature },
        body,
      })
      const json = (await res.json()) as { error?: unknown }
      results.push({ url, targetBlock, ok: res.ok && !json.error, response: json })
    } catch (err) {
      results.push({ url, targetBlock, ok: false, response: String(err) })
    }
  }
  return results
}

/**
 * Submits the same bundle to `blockCount` consecutive upcoming blocks
 * (starting at `fromBlock`), the standard "spray across several target
 * blocks" pattern for a relay with no cross-block retry of its own. Returns
 * once all submissions are sent, this does NOT wait for or confirm
 * inclusion; callers must poll receipts and fall back on their own timeout
 * (see run.ts).
 */
export async function submitBundleAcrossBlocks(
  reputationAccount: PrivateKeyAccount,
  rawTxs: Hex[],
  fromBlock: bigint,
  blockCount: number,
  relayUrls: readonly string[] = FLASHBOTS_SEPOLIA_RELAY_URLS,
): Promise<BundleSubmitResult[]> {
  const all: BundleSubmitResult[] = []
  for (let i = 0; i < blockCount; i++) {
    const results = await submitBundle(reputationAccount, rawTxs, fromBlock + BigInt(i), relayUrls)
    all.push(...results)
  }
  return all
}
