// Distributor: funds each freshly-rotated, single-use probe EOA
// (cycle/dispatch.ts's rotateEOA) from one long-lived mainnet account, and
// sweeps the leftover back after the probe settles so capital recirculates
// across cycles instead of stranding on disposable addresses. This is the
// piece PRD §18 deferred ("Rotated single-use EOAs funded through a
// distributor. Have this answer ready before it's asked" / "Probes cost real
// money") and PRD §14 P2 needs before any probe can land on mainnet.
//
// ------------------------------------------------------------------------
// FINGERPRINTS THIS MODULE DEFENDS AGAINST
// ------------------------------------------------------------------------
// PRD §18: "the moment a relay can recognise the prober, it gives that
// address special treatment and the measurement dies." Concretely:
//
//   1. Identical funding amount across probes. If every probe were funded
//      with the exact same wei figure, that figure becomes a signature a
//      relay/searcher can grep the mempool for, independent of the probe
//      address itself. Mitigated by `randomJitterWei`: every probe's funding
//      = (swap value + gas budget) + a random surplus resampled per probe,
//      so no two probes in the fleet ever receive the same amount, and the
//      figure is never a round number of ETH or gwei either.
//
//   2. One distributor transaction touching more than one probe. A single
//      funding tx with multiple recipients, or several funding txs mined in
//      the same block, visibly ties every probe it touches together before
//      the swap even happens — worse than fingerprinting a single address,
//      it fingerprints the whole cohort at once. Mitigated structurally:
//      `DistributorClient.fundProbe` takes exactly one `to` address and
//      sends exactly one transaction. `cycle/run.ts` calls it once per leg
//      and sleeps a configurable, jittered delay (`FUNDING_MIN_DELAY_MS` +
//      `FUNDING_JITTER_DELAY_MS`) between fundings so they are not
//      submitted back-to-back into the same block window.
//
//   3. Burning gas to "clean up" dust. A leftover balance worth less than
//      the gas needed to move it would make the sweep a net loss and leave
//      an on-chain trail of an uneconomical transaction. Mitigated:
//      `sweepProbe` estimates the sweep's own gas cost first and skips the
//      transfer (recording `dustSkipped: true`) when the leftover doesn't
//      clear it, rather than submitting anyway.
//
// ------------------------------------------------------------------------
// FINGERPRINTS THIS MODULE DOES **NOT** DEFEND AGAINST — said plainly per
// this task's brief, rather than implying more anonymity than exists
// ------------------------------------------------------------------------
//
//   - Common funding ancestor. Every probe EOA is still exactly one hop from
//     the same distributor address on-chain, and every sweep sends value
//     back to that same address. Anyone clustering addresses by "funded by
//     / swept to X" links every probe in the fleet to Gokuin, permanently.
//     Breaking this would need a mixer, CoinJoin-style batched settlement,
//     or a chain of disposable intermediate funders — none of that is built
//     here.
//   - Calldata / gas-parameter fingerprinting. Both legs of a twin share
//     byte-identical swap calldata and the same fee-estimation logic
//     (cycle/dispatch.ts) — deliberately, since that identity is what makes
//     the twin comparison meaningful. A route operator fingerprinting by
//     calldata shape or fee curve, rather than by funding, is untouched by
//     this module.
//   - Timing correlation across cycles. Funding happens shortly before its
//     probe's swap, every cycle. An adversary who watches the distributor
//     address and notices "a fresh EOA gets funded, then a swap appears on
//     this route N seconds later" repeatedly can still build a timing
//     fingerprint across many cycles. The jittered delay raises the cost of
//     this correlation; it does not remove it.
//   - Distributor address reuse across the project's whole lifetime. A
//     single long-lived distributor is deliberately simple to operate and
//     to preflight-fund, but it is itself a fixed, nameable address that
//     never rotates.
//
// ------------------------------------------------------------------------
// DRY-RUN CONVENTION — and why it differs from dispatch.ts's
// ------------------------------------------------------------------------
// dispatch.ts's probe legs always have a real key (`rotateEOA` generates one
// on the spot), so submitLeg always *signs* for real and only skips the
// network call. The distributor has no such luxury: without `DISTRIBUTOR_PK`
// there is no key at all to sign a funding transaction with. So `fundProbe`
// follows chain/ledger.ts's convention instead — real fee estimation always
// happens against the real (possibly fixture) RPC, and only the
// signature+broadcast step is replaced with a deterministic, clearly logged
// stand-in hash when no key is configured. `sweepProbe`, by contrast, is
// signed by the *probe's* own in-memory key (always real, exactly like
// dispatch.ts) — only its broadcast is skipped when the distributor has
// nothing configured to sweep back to.
import { encodePacked, keccak256, parseGwei, type Hex, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { Env } from '../env'
import { SWAP_GAS_LIMIT } from '../cycle/dispatch'

/** Plain ETH transfer gas limit — funding and sweep transactions carry no calldata. */
export const FUND_TRANSFER_GAS_LIMIT = 21_000n
export const SWEEP_TRANSFER_GAS_LIMIT = 21_000n

export interface FundingConfig {
  /** Multiplier applied to (gas limit * fee) to size the gas portion of a probe's funding — headroom against fee spikes between funding and dispatch. */
  gasHeadroomMultiplier: number
  /** Max size, in bps of (swap value + gas budget), of the random surplus added on top so funding amounts are never identical or round. */
  amountJitterBps: number
  /** Minimum delay (ms) between successive funding transactions within one cycle. */
  minDelayMs: number
  /** Additional randomized delay (ms), on top of minDelayMs, resampled per funding. */
  jitterDelayMs: number
  /** Multiplier applied to the plain sweep-transfer gas cost when deciding whether a leftover is dust. */
  sweepGasBufferMultiplier: number
}

export function loadFundingConfig(env: Env): FundingConfig {
  return {
    gasHeadroomMultiplier: env.FUNDING_GAS_HEADROOM_MULTIPLIER,
    amountJitterBps: env.FUNDING_AMOUNT_JITTER_BPS,
    minDelayMs: env.FUNDING_MIN_DELAY_MS,
    jitterDelayMs: env.FUNDING_JITTER_DELAY_MS,
    sweepGasBufferMultiplier: env.SWEEP_GAS_BUFFER_MULTIPLIER,
  }
}

function bps(multiplier: number): bigint {
  return BigInt(Math.max(0, Math.round(multiplier * 10_000)))
}

/** The gas-only portion of a probe's funding: gasLimit * fee, with configurable headroom. */
export function gasBudgetWei(gasLimit: bigint, maxFeePerGas: bigint, headroomMultiplier: number): bigint {
  return (gasLimit * maxFeePerGas * bps(headroomMultiplier)) / 10_000n
}

/**
 * A random, non-zero surplus in [1, maxJitter] wei, where maxJitter is a
 * small bps fraction of `baseWei`. Uses `crypto.getRandomValues` (never
 * `Math.random`, which is not a fingerprinting-safe source) so it cannot be
 * predicted or replayed. Always >= 1n when baseWei > 0 and jitterBps > 0 —
 * this is what keeps the final funded amount off a round number, on top of
 * making it differ probe-to-probe.
 */
export function randomJitterWei(baseWei: bigint, jitterBps: number): bigint {
  if (baseWei <= 0n || jitterBps <= 0) return 1n
  const maxJitter = (baseWei * BigInt(Math.max(1, Math.round(jitterBps)))) / 10_000n
  if (maxJitter <= 0n) return 1n
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  let r = 0n
  for (const b of buf) r = (r << 8n) | BigInt(b)
  return 1n + (r % maxJitter)
}

export interface CycleFundingRequirement {
  /** Deterministic upper bound (worst-case jitter) of what any single probe in this cycle could need. */
  perProbeMaxWei: bigint
  /** Gas the distributor itself spends broadcasting the funding transfers. */
  distributorGasReserveWei: bigint
  totalRequiredWei: bigint
}

export class InsufficientDistributorFundsError extends Error {
  constructor(
    public readonly requiredWei: bigint,
    public readonly availableWei: bigint,
  ) {
    super(`distributor cannot cover this cycle: needs ${requiredWei} wei, has ${availableWei} wei`)
    this.name = 'InsufficientDistributorFundsError'
  }
}

async function feeParams(publicClient: PublicClient): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const fees = await publicClient.estimateFeesPerGas().catch(() => null)
  return {
    maxFeePerGas: fees?.maxFeePerGas ?? parseGwei('30'),
    maxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? parseGwei('2'),
  }
}

/** Deterministic worst-case funding figure (full jitter headroom, not a random sample) — used only for preflight, so a lucky/unlucky random draw at actual funding time can never exceed what preflight checked for. */
export function maxFundingAmountWei(swapValueWei: bigint, gasBudget: bigint, jitterBps: number): bigint {
  const base = swapValueWei + gasBudget
  if (jitterBps <= 0 || base <= 0n) return base
  // Mirrors randomJitterWei's own floor of 1n so this bound is never
  // undercut by an actual (randomly sampled) jitter draw.
  const maxJitter = (base * BigInt(Math.max(1, Math.round(jitterBps)))) / 10_000n
  return base + (maxJitter > 0n ? maxJitter : 1n)
}

export async function estimateCycleFundingRequirement(
  publicClient: PublicClient,
  probeCount: number,
  swapValueWei: bigint,
  config: FundingConfig,
): Promise<CycleFundingRequirement> {
  const { maxFeePerGas } = await feeParams(publicClient)
  const gasBudget = gasBudgetWei(SWAP_GAS_LIMIT, maxFeePerGas, config.gasHeadroomMultiplier)
  const perProbeMaxWei = maxFundingAmountWei(swapValueWei, gasBudget, config.amountJitterBps)
  const distributorGasReserveWei = BigInt(probeCount) * FUND_TRANSFER_GAS_LIMIT * maxFeePerGas
  return {
    perProbeMaxWei,
    distributorGasReserveWei,
    totalRequiredWei: perProbeMaxWei * BigInt(probeCount) + distributorGasReserveWei,
  }
}

/**
 * PRD §7.3's commit-before-dispatch ordering exists so nothing is dispatched
 * against a schedule that was never really committed-for. This preflight is
 * the funding-side mirror of that same principle (this task's requirement
 * 5): a cycle that is committed but then cannot actually execute creates
 * exactly the committed-vs-published gap that `ProbeLedger.integrity()` is
 * built to flag as dishonesty. Call this — and let it throw — BEFORE
 * `ledger.commitCycle()`, not after.
 *
 * When no `DISTRIBUTOR_PK` is configured at all, there is no real balance to
 * check against, so this logs the computed requirement and passes rather
 * than hard-failing every dry-run/dev cycle — consistent with the rest of
 * this codebase's "unconfigured -> dry-run, never a crash" convention.
 */
export async function preflightDistributorFunding(
  publicClient: PublicClient,
  distributor: DistributorClient,
  probeCount: number,
  swapValueWei: bigint,
  config: FundingConfig,
): Promise<CycleFundingRequirement> {
  const requirement = await estimateCycleFundingRequirement(publicClient, probeCount, swapValueWei, config)
  if (distributor.dryRun) {
    console.warn(
      `[distributor:dry-run] no DISTRIBUTOR_PK configured — skipping balance preflight. ` +
        `would require ~${requirement.totalRequiredWei} wei to cover ${probeCount} probe(s).`,
    )
    return requirement
  }
  const balance = await distributor.balanceWei()
  if (balance < requirement.totalRequiredWei) {
    throw new InsufficientDistributorFundsError(requirement.totalRequiredWei, balance)
  }
  return requirement
}

export interface ProbeFundingPlan {
  amountWei: bigint
  gasBudgetWei: bigint
  jitterWei: bigint
}

/** The real, randomized per-probe funding figure — sampled fresh for each probe, right before it is sent. */
export async function planProbeFunding(
  publicClient: PublicClient,
  swapValueWei: bigint,
  config: FundingConfig,
): Promise<ProbeFundingPlan> {
  const { maxFeePerGas } = await feeParams(publicClient)
  const gasBudget = gasBudgetWei(SWAP_GAS_LIMIT, maxFeePerGas, config.gasHeadroomMultiplier)
  const base = swapValueWei + gasBudget
  const jitterWei = randomJitterWei(base, config.amountJitterBps)
  return { amountWei: base + jitterWei, gasBudgetWei: gasBudget, jitterWei }
}

/** Delay (ms) to wait before the *next* funding transaction in a cycle, so consecutive fundings don't land in the same block window. */
export function nextFundingDelayMs(config: FundingConfig): number {
  const jitter = config.jitterDelayMs > 0 ? Math.floor(Math.random() * (config.jitterDelayMs + 1)) : 0
  return Math.max(0, config.minDelayMs) + jitter
}

export interface DistributorSendResult {
  txHash: Hex
  dryRun: boolean
}

export interface SweepOutcome {
  txHash: Hex | null
  sweptAmountWei: bigint
  dustSkipped: boolean
  dryRun: boolean
}

export class DistributorClient {
  /** True when there is no DISTRIBUTOR_PK at all — nothing to fund with or sweep back to. */
  readonly dryRun: boolean

  constructor(
    private readonly publicClient: PublicClient,
    private readonly account: PrivateKeyAccount | null,
  ) {
    this.dryRun = !account
  }

  get address(): Hex | null {
    return this.account?.address ?? null
  }

  async balanceWei(): Promise<bigint> {
    if (!this.account) return 0n
    return this.publicClient.getBalance({ address: this.account.address })
  }

  /**
   * Funds exactly one probe address with exactly one transaction — never
   * fold more than one probe into a single distributor tx (see module
   * header, fingerprint #2). Fee estimation always hits the real (possibly
   * fixture) RPC; only signing+broadcast is stood in for when no
   * DISTRIBUTOR_PK is configured (see module header's dry-run convention).
   */
  async fundProbe(to: Hex, amountWei: bigint, probeId: number): Promise<DistributorSendResult> {
    const { maxFeePerGas, maxPriorityFeePerGas } = await feeParams(this.publicClient)
    if (!this.account) {
      const txHash = keccak256(encodePacked(['string', 'address', 'uint256', 'uint256'], ['fund', to, amountWei, BigInt(probeId)]))
      console.warn(
        `[distributor:dry-run] no DISTRIBUTOR_PK configured — not funding probe ${probeId} (${to}) with ${amountWei} wei. stand-in hash ${txHash}`,
      )
      return { txHash, dryRun: true }
    }
    const nonce = await this.publicClient.getTransactionCount({ address: this.account.address, blockTag: 'pending' })
    const signed = await this.account.signTransaction({
      to,
      value: amountWei,
      data: '0x',
      nonce,
      chainId: mainnet.id,
      gas: FUND_TRANSFER_GAS_LIMIT,
      maxFeePerGas,
      maxPriorityFeePerGas,
      type: 'eip1559',
    })
    const txHash = await this.publicClient.sendRawTransaction({ serializedTransaction: signed })
    return { txHash, dryRun: false }
  }

  /**
   * Sweeps a settled probe's leftover balance back to the distributor so
   * capital recirculates (this task's requirement 3). Signed by the probe's
   * own in-memory key — always real, exactly like dispatch.ts's submitLeg —
   * but skips broadcasting (and skips the transfer entirely when there is no
   * real distributor address to send it to) when this client is dry-run.
   * When the leftover balance would not clear its own gas cost to move, this
   * leaves it in place rather than burning gas on a losing transaction
   * (requirement 3 / module header fingerprint #3).
   */
  async sweepProbe(account: PrivateKeyAccount, probeId: number, config: FundingConfig): Promise<SweepOutcome> {
    const balance = await this.publicClient.getBalance({ address: account.address })
    const { maxFeePerGas, maxPriorityFeePerGas } = await feeParams(this.publicClient)
    const sweepGasCost = (SWEEP_TRANSFER_GAS_LIMIT * maxFeePerGas * bps(config.sweepGasBufferMultiplier)) / 10_000n

    if (balance <= sweepGasCost) {
      console.warn(
        `[distributor:sweep] probe ${probeId} (${account.address}) leftover ${balance} wei <= sweep cost budget ${sweepGasCost} wei — leaving dust in place rather than burning gas to move it`,
      )
      return { txHash: null, sweptAmountWei: 0n, dustSkipped: true, dryRun: this.dryRun }
    }

    const sweepAmountWei = balance - sweepGasCost
    const to = this.address
    if (!to) {
      // No real distributor address configured at all, so there is no real
      // destination to build a genuine transaction against — same shape of
      // problem fundProbe hits with no key. We still report the true
      // recoverable amount (it is a real, fully-computed number; only the
      // "where does it go" half is missing) via a deterministic stand-in
      // hash, exactly like fundProbe's own no-key fallback, rather than
      // inventing a destination to sign a real transfer against.
      const txHash = keccak256(encodePacked(['string', 'address', 'uint256'], ['sweep', account.address, sweepAmountWei]))
      console.warn(
        `[distributor:dry-run] no DISTRIBUTOR_PK configured — probe ${probeId} has ${sweepAmountWei} wei sweepable but nowhere configured to sweep it to. stand-in hash ${txHash}`,
      )
      return { txHash, sweptAmountWei: sweepAmountWei, dustSkipped: false, dryRun: true }
    }

    // `to` is only non-null when a distributor account is configured, so
    // this is always the "real" path — really signed by the probe's own
    // key, and really broadcast. There is no separate "signed but not
    // broadcast" state here: either there's a real destination and this
    // goes out for real, or there isn't (handled above) and we never reach
    // this signing step at all.
    const signed = await account.signTransaction({
      to,
      value: sweepAmountWei,
      data: '0x',
      nonce: 1, // the probe's only prior tx is its swap at nonce 0 (dispatch.ts)
      chainId: mainnet.id,
      gas: SWEEP_TRANSFER_GAS_LIMIT,
      maxFeePerGas,
      maxPriorityFeePerGas,
      type: 'eip1559',
    })
    const txHash = await this.publicClient.sendRawTransaction({ serializedTransaction: signed })
    return { txHash, sweptAmountWei: sweepAmountWei, dustSkipped: false, dryRun: false }
  }
}

export function createDistributorClient(env: Env, publicClient: PublicClient): DistributorClient {
  const account = env.DISTRIBUTOR_PK ? privateKeyToAccount(env.DISTRIBUTOR_PK as Hex) : null
  return new DistributorClient(publicClient, account)
}
