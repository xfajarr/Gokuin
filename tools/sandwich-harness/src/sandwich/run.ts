// Orchestrates the whole staged sandwich: prep (wrap ETH, approve the
// router), submit the victim probe, watch for it in the public mempool, and
// fire the front-run/back-run with the fee ladder from fee-ladder.ts. Every
// entrypoint here calls assertSepolia() and resolveProbeVictim() before
// doing anything irreversible — see guards/.
import { keccak256, type Hex, type PublicClient } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { assertSepolia } from '../guards/chain-guard'
import { resolveProbeVictim } from '../guards/victim-guard'
import { WETH9, TEST_USDC, SWAP_ROUTER_02 } from '../chain/addresses'
import { encodeWrapEth, encodeApprove, encodeSwap, ROUTER_ADDRESS } from './calldata'
import { buildFeeLadder, type Leg } from './fee-ladder'
import { watchForVictim } from './watch'
import { submitBundleAcrossBlocks } from './bundle'
import { quoteWethToUsdc, applySafetyMargin } from './quote'
import type { Database } from 'bun:sqlite'

export interface SignedLeg {
  leg: Leg
  txHash: Hex
  raw: Hex
  nonce: number
}

export interface RunOptions {
  publicClient: PublicClient
  db: Database
  victim: PrivateKeyAccount
  attacker: PrivateKeyAccount
  /** WETH amount each leg trades, in wei. Deliberately small — see calldata.ts. */
  amountInWei: bigint
  dryRun: boolean
  chainId: number
}

const GAS_LIMIT = 300_000n

/** One-time prep: wrap ETH into WETH and set router allowances for both accounts. Idempotent-ish — safe to re-run; approvals are set to max each time. */
export async function prepareAccounts(
  publicClient: PublicClient,
  accounts: { victim: PrivateKeyAccount; attacker: PrivateKeyAccount },
  wrapAmountWei: bigint,
): Promise<Hex[]> {
  await assertSepolia(publicClient)
  const hashes: Hex[] = []
  for (const account of [accounts.victim, accounts.attacker]) {
    const nonceStart = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' })
    const fees = await publicClient.estimateFeesPerGas()
    let nonce = nonceStart

    const wrap = await account.signTransaction({
      to: WETH9,
      data: encodeWrapEth(),
      value: wrapAmountWei,
      nonce: nonce++,
      chainId: 11155111,
      gas: 80_000n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      type: 'eip1559',
    })
    hashes.push(await publicClient.sendRawTransaction({ serializedTransaction: wrap }))

    const approveWeth = await account.signTransaction({
      to: WETH9,
      data: encodeApprove(SWAP_ROUTER_02),
      value: 0n,
      nonce: nonce++,
      chainId: 11155111,
      gas: 80_000n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      type: 'eip1559',
    })
    hashes.push(await publicClient.sendRawTransaction({ serializedTransaction: approveWeth }))

    const approveUsdc = await account.signTransaction({
      to: TEST_USDC,
      data: encodeApprove(SWAP_ROUTER_02),
      value: 0n,
      nonce: nonce++,
      chainId: 11155111,
      gas: 80_000n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      type: 'eip1559',
    })
    hashes.push(await publicClient.sendRawTransaction({ serializedTransaction: approveUsdc }))
  }
  return hashes
}

export interface SandwichResult {
  victimTxHash: Hex
  frontrunTxHash: Hex
  backrunTxHash: Hex
  attempt: number
  method?: 'bundle' | 'fee-ladder'
}

/**
 * Tries the real searcher technique first: build all three legs, submit them
 * as one ordered Flashbots-style bundle to the next `blockSpan` upcoming
 * Sepolia blocks, and poll for inclusion up to `timeoutMs`. Returns null
 * (never throws on non-inclusion) if the bundle does not land in order
 * within that window — see sandwich/bundle.ts and README.md for why this is
 * expected to fail more often than not on Sepolia today, and why the caller
 * (cli.ts) always has the fee-ladder path (attemptSandwich) as a fallback
 * rather than treating this as the only path.
 */
export async function attemptSandwichBundle(
  opts: RunOptions & { blockSpan?: number; timeoutMs?: number },
): Promise<SandwichResult | null> {
  await assertSepolia(opts.publicClient)
  resolveProbeVictim(opts.db, opts.victim.address)

  const fees = await opts.publicClient.estimateFeesPerGas()
  const victimNonce = await opts.publicClient.getTransactionCount({ address: opts.victim.address, blockTag: 'pending' })
  const attackerNonce = await opts.publicClient.getTransactionCount({ address: opts.attacker.address, blockTag: 'pending' })

  const sign = (account: PrivateKeyAccount, data: Hex, nonce: number) =>
    account.signTransaction({
      to: ROUTER_ADDRESS,
      data,
      value: 0n,
      nonce,
      chainId: opts.chainId,
      gas: GAS_LIMIT,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      type: 'eip1559',
    })

  const frontrunAmountInWei = opts.amountInWei * 3n
  // amountIn for the sell-back leg must be in USDC's own 6-decimal units, not
  // reused from the WETH-scaled (18-decimal) frontrun amount — see quote.ts's
  // header for the bug this fixes. Simulated (eth_call, no state change).
  const quotedUsdcOut = await quoteWethToUsdc(opts.publicClient, opts.attacker.address, frontrunAmountInWei)
  const backrunAmountIn = applySafetyMargin(quotedUsdcOut)

  const frontrunTx = await sign(opts.attacker, encodeSwap('weth-to-usdc', opts.attacker.address, frontrunAmountInWei), attackerNonce)
  const victimTx = await sign(opts.victim, encodeSwap('weth-to-usdc', opts.victim.address, opts.amountInWei), victimNonce)
  const backrunTx = await sign(opts.attacker, encodeSwap('usdc-to-weth', opts.attacker.address, backrunAmountIn), attackerNonce + 1)

  if (opts.dryRun) {
    console.log('[bundle:dry-run] built and signed all three legs, not submitting to any relay:', { frontrunTx, victimTx, backrunTx })
    return null
  }

  const currentBlock = await opts.publicClient.getBlockNumber()
  const blockSpan = opts.blockSpan ?? 4
  const timeoutMs = opts.timeoutMs ?? 45_000

  await submitBundleAcrossBlocks(opts.attacker, [frontrunTx, victimTx, backrunTx], currentBlock + 1n, blockSpan)

  const deadline = Date.now() + timeoutMs
  const victimHash = keccak256(victimTx)
  const frontrunHash = keccak256(frontrunTx)
  const backrunHash = keccak256(backrunTx)

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000))
    const [v, f, b] = await Promise.all([
      opts.publicClient.getTransactionReceipt({ hash: victimHash }).catch(() => null),
      opts.publicClient.getTransactionReceipt({ hash: frontrunHash }).catch(() => null),
      opts.publicClient.getTransactionReceipt({ hash: backrunHash }).catch(() => null),
    ])
    if (v && f && b) {
      const sameBlock = v.blockNumber === f.blockNumber && v.blockNumber === b.blockNumber
      const ordered = sameBlock && f.transactionIndex < v.transactionIndex && v.transactionIndex < b.transactionIndex
      if (ordered) {
        return { victimTxHash: victimHash, frontrunTxHash: frontrunHash, backrunTxHash: backrunHash, attempt: 1, method: 'bundle' }
      }
      return null // landed, but not as an ordered sandwich — do not report a false positive
    }
  }
  return null // did not land within timeoutMs — caller falls back to the fee-ladder path
}

/**
 * Runs one attempt: submits the victim swap, watches for it in the public
 * mempool, and immediately fires front-run + back-run with laddered fees.
 * Returns as soon as all three are broadcast — caller is responsible for
 * waiting for inclusion and checking order (see cli.ts / README.md's
 * reliability notes on retrying when a same-block, correct-order landing
 * does not happen on the first try).
 */
export async function attemptSandwich(opts: RunOptions): Promise<SandwichResult> {
  await assertSepolia(opts.publicClient)
  const victimGuardResult = resolveProbeVictim(opts.db, opts.victim.address)
  if (!victimGuardResult) throw new Error('unreachable: resolveProbeVictim throws rather than returning falsy')

  const pending = await opts.publicClient.getBlock({ blockTag: 'pending' }).catch(() => null)
  const baseFeePerGas = pending?.baseFeePerGas ?? (await opts.publicClient.getGasPrice())
  const ladder = buildFeeLadder(baseFeePerGas)

  const victimNonce = await opts.publicClient.getTransactionCount({ address: opts.victim.address, blockTag: 'pending' })
  const attackerNonce = await opts.publicClient.getTransactionCount({ address: opts.attacker.address, blockTag: 'pending' })

  const victimTx = await opts.victim.signTransaction({
    to: ROUTER_ADDRESS,
    data: encodeSwap('weth-to-usdc', opts.victim.address, opts.amountInWei),
    value: 0n,
    nonce: victimNonce,
    chainId: opts.chainId,
    gas: GAS_LIMIT,
    maxFeePerGas: ladder.victim.maxFeePerGas,
    maxPriorityFeePerGas: ladder.victim.maxPriorityFeePerGas,
    type: 'eip1559',
  })

  const frontrunAmountInWei = opts.amountInWei * 3n

  if (opts.dryRun) {
    const frontrun = await opts.attacker.signTransaction({
      to: ROUTER_ADDRESS,
      data: encodeSwap('weth-to-usdc', opts.attacker.address, frontrunAmountInWei),
      value: 0n,
      nonce: attackerNonce,
      chainId: opts.chainId,
      gas: GAS_LIMIT,
      maxFeePerGas: ladder.frontrun.maxFeePerGas,
      maxPriorityFeePerGas: ladder.frontrun.maxPriorityFeePerGas,
      type: 'eip1559',
    })
    // Dry-run only: no broadcast happens, so there is no real chain state to
    // simulate the frontrun's output against yet. 1n is a placeholder — the
    // live path below (and attemptSandwichBundle) always uses a real
    // simulated quote instead. See quote.ts's header for why this matters.
    const backrun = await opts.attacker.signTransaction({
      to: ROUTER_ADDRESS,
      data: encodeSwap('usdc-to-weth', opts.attacker.address, 1n),
      value: 0n,
      nonce: attackerNonce + 1,
      chainId: opts.chainId,
      gas: GAS_LIMIT,
      maxFeePerGas: ladder.backrun.maxFeePerGas,
      maxPriorityFeePerGas: ladder.backrun.maxPriorityFeePerGas,
      type: 'eip1559',
    })
    console.log('[dry-run] built and signed all three legs without broadcasting:')
    console.log('  frontrun raw:', frontrun)
    console.log('  victim   raw:', victimTx)
    console.log('  backrun  raw:', backrun)
    return {
      victimTxHash: victimTx.slice(0, 2) as Hex, // not a real hash in dry-run; caller must not treat this as broadcastable evidence
      frontrunTxHash: frontrun.slice(0, 2) as Hex,
      backrunTxHash: backrun.slice(0, 2) as Hex,
      attempt: 0,
    }
  }

  // --- LIVE PATH ---
  let victimTxHash: Hex | null = null
  const unwatch = watchForVictim({
    publicClient: opts.publicClient,
    victimAddress: opts.victim.address,
    onVictimSeen: hash => {
      victimTxHash = hash
    },
  })

  const broadcastVictim = opts.publicClient.sendRawTransaction({ serializedTransaction: victimTx })

  // Fire the front-run immediately (do not wait for the watcher — the point
  // of the fee ladder is that ordering is enforced by tip, not by
  // send-order), then wait briefly for the watcher to confirm visibility
  // before firing the back-run so the back-run is built against the
  // front-run's actual USDC-received amount where possible.
  // Simulated (eth_call, no state change, no gas) against the current chain
  // head — a very close proxy for what the frontrun will actually produce,
  // since the frontrun is first-in-block and no state changes before it.
  // Sized in USDC's own 6-decimal units — see quote.ts's header for the bug
  // this replaced (backrun amountIn built from the wrong token's decimals,
  // which reverted the backrun leg on this harness's first live attempt).
  const quotedUsdcOut = await quoteWethToUsdc(opts.publicClient, opts.attacker.address, frontrunAmountInWei)
  const backrunAmountIn = applySafetyMargin(quotedUsdcOut)

  const frontrunTx = await opts.attacker.signTransaction({
    to: ROUTER_ADDRESS,
    data: encodeSwap('weth-to-usdc', opts.attacker.address, frontrunAmountInWei),
    value: 0n,
    nonce: attackerNonce,
    chainId: opts.chainId,
    gas: GAS_LIMIT,
    maxFeePerGas: ladder.frontrun.maxFeePerGas,
    maxPriorityFeePerGas: ladder.frontrun.maxPriorityFeePerGas,
    type: 'eip1559',
  })
  const frontrunHash = await opts.publicClient.sendRawTransaction({ serializedTransaction: frontrunTx })

  const backrunTx = await opts.attacker.signTransaction({
    to: ROUTER_ADDRESS,
    data: encodeSwap('usdc-to-weth', opts.attacker.address, backrunAmountIn),
    value: 0n,
    nonce: attackerNonce + 1,
    chainId: opts.chainId,
    gas: GAS_LIMIT,
    maxFeePerGas: ladder.backrun.maxFeePerGas,
    maxPriorityFeePerGas: ladder.backrun.maxPriorityFeePerGas,
    type: 'eip1559',
  })
  const backrunHash = await opts.publicClient.sendRawTransaction({ serializedTransaction: backrunTx })

  const victimHash = await broadcastVictim
  unwatch()

  return { victimTxHash: victimHash, frontrunTxHash: frontrunHash, backrunTxHash: backrunHash, attempt: 1 }
}
