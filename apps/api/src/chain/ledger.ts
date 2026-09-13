// ProbeLedger writes via viem. The ABI is GENERATED from `forge build` output
// by packages/abi, never hand-declared. A hand-written signature that drifts
// from the deployed contract fails at broadcast, not at compile time, and the
// first place we would notice is a reverted reveal on camera.
//
// Dry-run behaviour: the call is ALWAYS abi-encoded for real via
// `encodeFunctionData`: that part of the code path is never stubbed. If a
// wallet client and a deployed address are both configured, the encoded call
// is actually sent. Otherwise the encoded calldata is hashed into a
// deterministic, clearly-labelled stand-in tx hash so callers (cycle
// orchestration, tests) exercise the identical control flow either way.
import { encodeFunctionData, keccak256, type Hex, type PublicClient, type WalletClient } from 'viem'
import { ProbeLedgerAbi } from '@gokuin/abi'
import type { Row } from '@gokuin/core'
import type { Env } from '../env'

export const PROBE_LEDGER_ABI = ProbeLedgerAbi

export interface LedgerWriteResult {
  txHash: Hex
  dryRun: boolean
}

function dryRunResult(calldata: Hex): LedgerWriteResult {
  const txHash = keccak256(calldata)
  console.warn(`[ledger:dry-run] no PROBER_PK/PROBE_LEDGER_ADDRESS configured, not broadcasting. calldata hash ${txHash}`)
  return { txHash, dryRun: true }
}

export class ProbeLedgerClient {
  readonly dryRun: boolean

  constructor(
    private readonly env: Env,
    private readonly wallet: WalletClient | null,
    private readonly publicClient: PublicClient,
  ) {
    this.dryRun = !wallet || !env.PROBE_LEDGER_ADDRESS
  }

  private get address(): Hex | undefined {
    return this.env.PROBE_LEDGER_ADDRESS as Hex | undefined
  }

  async commitCycle(cycleId: number, scheduleHash: Hex, count: number): Promise<LedgerWriteResult> {
    const calldata = encodeFunctionData({
      abi: PROBE_LEDGER_ABI,
      functionName: 'commitCycle',
      args: [cycleId, scheduleHash, count],
    })
    if (!this.wallet || !this.address) return dryRunResult(calldata)
    const hash = await this.wallet.sendTransaction({
      account: this.wallet.account!,
      chain: this.wallet.chain,
      to: this.address,
      data: calldata,
    })
    return { txHash: hash, dryRun: false }
  }

  async record(cycleId: number, row: Row): Promise<LedgerWriteResult> {
    const calldata = encodeFunctionData({
      abi: PROBE_LEDGER_ABI,
      functionName: 'record',
      args: [
        cycleId,
        {
          mainnetTxHash: row.mainnetTxHash,
          submittedBlock: BigInt(row.submittedBlock),
          includedBlock: BigInt(row.includedBlock),
          leakedAtBlock: BigInt(row.leakedAtBlock),
          extractedWei: row.extractedWei,
          simOut: row.simOut,
          realOut: row.realOut,
          routeId: row.routeId,
          cycleId: row.cycleId,
          sandwiched: row.sandwiched,
        },
      ],
    })
    if (!this.wallet || !this.address) return dryRunResult(calldata)
    const hash = await this.wallet.sendTransaction({
      account: this.wallet.account!,
      chain: this.wallet.chain,
      to: this.address,
      data: calldata,
    })
    return { txHash: hash, dryRun: false }
  }

  /**
   * The commitment is over (cycleId, routeIds, slots, salt), so the contract
   * cannot verify a revealed salt without also being handed routeIds and slots.
   * Both are public the moment probes dispatch. Passing only the salt would make
   * BadSalt unenforceable and the integrity check meaningless.
   */
  async revealCycle(
    cycleId: number,
    routeIds: readonly number[],
    slots: readonly number[],
    salt: Hex,
  ): Promise<LedgerWriteResult> {
    const calldata = encodeFunctionData({
      abi: PROBE_LEDGER_ABI,
      functionName: 'revealCycle',
      args: [cycleId, routeIds, slots.map(BigInt), salt],
    })
    if (!this.wallet || !this.address) return dryRunResult(calldata)
    const hash = await this.wallet.sendTransaction({
      account: this.wallet.account!,
      chain: this.wallet.chain,
      to: this.address,
      data: calldata,
    })
    return { txHash: hash, dryRun: false }
  }

  /** committed vs published, straight from the contract's own view function. */
  async integrity(cycleId: number): Promise<{ committed: number; published: number; intact: boolean } | null> {
    if (!this.address) return null
    const [committed, published, intact] = (await this.publicClient.readContract({
      address: this.address,
      abi: PROBE_LEDGER_ABI,
      functionName: 'integrity',
      args: [cycleId],
    })) as [number, number, boolean]
    return { committed, published, intact }
  }
}

export function createLedgerClient(env: Env, wallet: WalletClient | null, publicClient: PublicClient) {
  return new ProbeLedgerClient(env, wallet, publicClient)
}
