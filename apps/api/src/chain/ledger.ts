// ProbeLedger writes via viem. contracts/ has not been built/deployed in this
// workspace yet (out of this task's scope — apps/api and apps/listener only),
// so the ABI is hand-declared here from PRD.md §6.1 and MUST be kept in sync
// with contracts/src/ProbeLedger.sol whenever that lands.
//
// Dry-run behaviour: the call is ALWAYS abi-encoded for real via
// `encodeFunctionData` — that part of the code path is never stubbed. If a
// wallet client and a deployed address are both configured, the encoded call
// is actually sent. Otherwise the encoded calldata is hashed into a
// deterministic, clearly-labelled stand-in tx hash so callers (cycle
// orchestration, tests) exercise the identical control flow either way.
import { encodeFunctionData, keccak256, type Hex, type PublicClient, type WalletClient } from 'viem'
import type { Row } from '@gokuin/core'
import type { Env } from '../env'

export const PROBE_LEDGER_ABI = [
  {
    type: 'function',
    name: 'commitCycle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'cycleId', type: 'uint16' },
      { name: 'scheduleHash', type: 'bytes32' },
      { name: 'count', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'record',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'cycleId', type: 'uint16' },
      {
        name: 'row',
        type: 'tuple',
        components: [
          { name: 'mainnetTxHash', type: 'bytes32' },
          { name: 'submittedBlock', type: 'uint64' },
          { name: 'includedBlock', type: 'uint64' },
          { name: 'leakedAtBlock', type: 'uint64' },
          { name: 'extractedWei', type: 'uint128' },
          { name: 'simOut', type: 'uint128' },
          { name: 'realOut', type: 'uint128' },
          { name: 'routeId', type: 'uint32' },
          { name: 'cycleId', type: 'uint16' },
          { name: 'sandwiched', type: 'bool' },
        ],
      },
    ],
    outputs: [{ name: 'rowId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'revealCycle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'cycleId', type: 'uint16' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'integrity',
    stateMutability: 'view',
    inputs: [{ name: 'cycleId', type: 'uint16' }],
    outputs: [
      { name: 'committed', type: 'uint16' },
      { name: 'published', type: 'uint16' },
      { name: 'intact', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'rowsByRoute',
    stateMutability: 'view',
    inputs: [{ name: 'routeId', type: 'uint32' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'rowCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export interface LedgerWriteResult {
  txHash: Hex
  dryRun: boolean
}

function dryRunResult(calldata: Hex): LedgerWriteResult {
  const txHash = keccak256(calldata)
  console.warn(`[ledger:dry-run] no PROBER_PK/PROBE_LEDGER_ADDRESS configured — not broadcasting. calldata hash ${txHash}`)
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

  async revealCycle(cycleId: number, salt: Hex): Promise<LedgerWriteResult> {
    const calldata = encodeFunctionData({
      abi: PROBE_LEDGER_ABI,
      functionName: 'revealCycle',
      args: [cycleId, salt],
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
